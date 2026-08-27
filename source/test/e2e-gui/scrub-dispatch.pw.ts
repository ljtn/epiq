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

// The press dispatches immediately and the moves are throttled, so without the
// release the last stretch of a drag would never be asked for.
test('a drag commits the position it ends on', async ({
	page,
	appUrl,
	pageErrors,
}) => {
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

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
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

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});
