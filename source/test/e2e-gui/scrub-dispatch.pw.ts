import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The suite shares one server, and a board left parked in the past never
// finishes loading for the next test.
const returnToLive = async (page: Page) => {
	const resume = page.getByRole('button', {name: 'Resume', exact: true});
	if ((await resume.count()) > 0 && (await resume.isEnabled())) {
		await resume.click();
		await expect(
			page.getByRole('button', {name: 'Now', exact: true}),
		).toBeVisible();
	}
};

// Every scrub makes the server check out the whole event log and answer with a
// full state broadcast, so a duplicate is not just a wasted frame.
test('a click on the track asks the server to scrub once', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const scrubs: string[] = [];

	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => {
			if (
				typeof message === 'string' &&
				message.includes('"type":"time-travel:scrub"')
			) {
				scrubs.push(message);
			}

			server.send(message);
		});
		server.onMessage(message => ws.send(message));
	});

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	await expect(track).toBeVisible();

	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
	await page.waitForTimeout(2000);

	expect(scrubs.length).toBe(1);

	// Returning to live and clicking the same spot is a real request again, so
	// the de-duplication must not outlive the scrub it belongs to.
	await page.getByRole('button', {name: 'Resume', exact: true}).click();
	await expect(
		page.getByRole('button', {name: 'Now', exact: true}),
	).toBeVisible();

	await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
	await page.waitForTimeout(2000);

	expect(scrubs.length).toBe(2);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// A drag is a gesture on the chart, never a native text selection: without
// user-select off, sweeping across could pick up the axis labels and drag them
// as a ghost.
test('a drag never starts a text selection', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	await expect(track).toHaveCSS('user-select', 'none');

	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.8, y, {steps: 10});

	const selected = await page.evaluate(
		'window.getSelection()?.toString() ?? ""',
	);
	await page.mouse.up();

	expect(selected).toBe('');

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// Watches every scrub the page asks the server for, in order.
const recordScrubs = async (page: Page): Promise<number[]> => {
	const targets: number[] = [];

	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => {
			if (
				typeof message === 'string' &&
				message.includes('"type":"time-travel:scrub"')
			) {
				targets.push(
					(JSON.parse(message) as {payload: {targetTime: number}}).payload
						.targetTime,
				);
			}

			server.send(message);
		});
		server.onMessage(message => ws.send(message));
	});

	return targets;
};

// The press dispatches immediately and the moves are throttled, so without the
// release the last stretch of a drag would never be asked for.
test('dragging the needle commits the position it ends on', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const targets = await recordScrubs(page);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;

	// The needle parks at the right edge while live, so it has to be put
	// somewhere draggable first.
	await page.mouse.click(box.x + box.width * 0.2, y);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toBeEnabled();

	const grip = page.getByTestId('scrubber-needle-grip');
	const gripBox = await grip.boundingBox();
	if (!gripBox) throw new Error('scrubber needle is not on screen');

	await page.mouse.move(gripBox.x + gripBox.width / 2, y);
	await page.mouse.down();
	for (const at of [0.4, 0.6, 0.8]) {
		await page.mouse.move(box.x + box.width * at, y);
	}
	await page.mouse.up();
	await page.waitForTimeout(2000);

	expect(targets.length).toBeGreaterThan(1);

	// The release lands on the far right, so the last request must be the
	// largest moment asked for.
	expect(targets[targets.length - 1]).toBe(Math.max(...targets));

	// A needle drag scrubs and nothing more: the window it was dragged across
	// is the same one it started in.
	expect(new URL(page.url()).searchParams.get('from')).toBeNull();

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The gesture the needle drag had to give up. Dragging anywhere else across
// the track picks a stretch of time and makes it the whole window, which is
// only unambiguous because it never scrubs on the way.
test('a drag across the track zooms the window to it, without scrubbing', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const targets = await recordScrubs(page);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Off "All", so the period pager is already on the row and the only thing
	// that can move the scope buttons is the one under test.
	const week = page.getByRole('button', {name: 'Week', exact: true});
	await week.click();
	await expect(week).toHaveAttribute('aria-pressed', 'true');

	const zoom = page.getByRole('button', {name: 'Zoom'});
	const hour = page.getByRole('button', {name: 'Hour', exact: true});
	const before = {
		hour: await hour.boundingBox(),
		zoom: await zoom.boundingBox(),
	};

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.3, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, y, {steps: 10});

	// The stretch is drawn while it is being dragged out, so it can be seen
	// before it is committed.
	await expect(page.getByTestId('scrubber-range-selection')).toBeVisible();

	await page.mouse.up();

	// The window is now none of the periods on offer, so the seventh option
	// stands for it and none of the rest reads as pressed.
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');
	await expect(week).toHaveAttribute('aria-pressed', 'false');

	// Zoom holds its width while it stands for nothing, so coming and going
	// never slides the row out from under the pointer.
	expect(await zoom.boundingBox()).toEqual(before.zoom);
	expect(await hour.boundingBox()).toEqual(before.hour);
	expect(before.zoom?.width).toBeGreaterThan(0);

	const params = new URL(page.url()).searchParams;
	const from = Number(params.get('from'));
	const to = Number(params.get('to'));
	expect(to).toBeGreaterThan(from);

	await page.waitForTimeout(2000);
	expect(targets).toEqual([]);

	// And back out again by naming a period, which is the only way out.
	await week.click();
	await expect(zoom).toHaveAttribute('aria-pressed', 'false');
	await expect(week).toHaveAttribute('aria-pressed', 'true');
	expect(new URL(page.url()).searchParams.get('from')).toBeNull();

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});
