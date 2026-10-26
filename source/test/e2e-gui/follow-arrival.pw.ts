// A write from another socket moves a following board. A mutation's reply goes
// only to its own socket, so this turns autosync on (restored in a `finally`).

import fs from 'node:fs';
import path from 'node:path';
import {expect, readHandoff, test} from './fixtures.js';
import {trackWithWindow} from './track.js';
import {returnToLive} from './live-board.js';

// A string, not a typed callback: the root tsconfig has no DOM lib.
const FILE_FROM_ELSEWHERE = `
new Promise(async (resolve, reject) => {
	const socket = new WebSocket('ws://' + window.location.host + '/ws');
	const send = body => socket.send(JSON.stringify(body));
	const next = type => new Promise(done => {
		const handler = event => {
			const message = JSON.parse(event.data);
			if (message.type !== type) return;
			socket.removeEventListener('message', handler);
			done(message);
		};
		socket.addEventListener('message', handler);
	});

	try {
		await new Promise(open => socket.addEventListener('open', open));

		const state = next('state');
		send({type: 'state:get'});
		const lane = (await state).payload?.value?.boards?.[0]?.swimlanes?.[0];
		if (!lane) throw new Error('no swimlane to file into');

		const created = next('issues:create:result');
		send({type: 'issues:create', payload: {parentId: lane.id, title: TITLE}});
		await created;
		resolve(null);
	} catch (error) {
		reject(error);
	}
});
`;

const fileFromElsewhere = async (
	page: import('@playwright/test').Page,
	title: string,
) => {
	await page.evaluate(
		`const TITLE = ${JSON.stringify(title)};\n${FILE_FROM_ELSEWHERE}`,
	);
};

test('a ticket filed by somebody else opens on a followed board', async ({
	page,
	appUrl,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		await page.goto(appUrl);
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		// Somewhere to be sitting, so the arrival below is not where the reader
		// already is — following opens nothing it is already showing.
		await page.getByTestId('add-issue').first().click();
		await page.getByPlaceholder('ticket name').fill('The ticket being read');
		await page.getByPlaceholder('ticket name').press('Enter');

		const ticketPanel = page
			.locator('aside')
			.filter({hasNot: page.getByTestId('event-log-header')});
		await expect(ticketPanel).toContainText('The ticket being read');

		// On the bar, so asking to go live is not itself reaching for the board.
		const live = page.getByTestId('live-toggle');
		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		// On as late as possible, and only for the write below.
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSync: true, autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

		const filed = `Filed from elsewhere ${Date.now()}`;
		await fileFromElsewhere(page, filed);

		// The board follows it. Generous, because this rides a real sync pass.
		await expect(ticketPanel).toContainText(filed, {timeout: 20_000});
		await expect(page.getByTestId('follow-banner')).toBeVisible();

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});

// A popped-out log keeps following and moves the board.
test('a popped-out log keeps following, and moves the board', async ({
	page,
	appUrl,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');
	let popout: import('@playwright/test').Page | undefined;

	try {
		// Short, so the seeded log overflows and can be scrolled back.
		await page.setViewportSize({width: 1100, height: 300});

		await page.goto(appUrl);
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		await page.getByTestId('add-issue').first().click();
		await page.getByPlaceholder('ticket name').fill('Read while popped out');
		await page.getByPlaceholder('ticket name').press('Enter');

		const ticketPanel = page
			.locator('aside')
			.filter({hasNot: page.getByTestId('event-log-header')});
		await expect(ticketPanel).toContainText('Read while popped out');

		const live = page.getByTestId('live-toggle');
		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		// Read back first, pausing following; the popped-out panel must report its own
		// pin. The scroll must exceed `PINNED_SLACK_PX` (two 18px rows).
		const pinnedSlackPx = 36;

		// Strings again: no DOM lib.
		const PANE = `document.querySelector('[data-testid="event-log"] .epiq-log-pane')`;

		// The pane mounts a beat after the toggle reports pressed, and an
		// evaluate on a missing element throws rather than retrying.
		await expect(
			page.getByTestId('event-log').locator('.epiq-log-pane'),
		).toHaveCount(1);

		await expect
			.poll(
				async () =>
					(await page.evaluate(
						`${PANE}.scrollHeight - ${PANE}.clientHeight`,
					)) as number,
			)
			.toBeGreaterThan(pinnedSlackPx);

		await page.evaluate(
			`${PANE}.scrollTop = 0; ${PANE}.dispatchEvent(new Event('scroll', {bubbles: true}));`,
		);

		// Out it goes. The docked panel is gone from this document entirely.
		const opened = page.context().waitForEvent('page');
		await page.getByTestId('log-pop-out').click();
		popout = await opened;
		await expect(popout.getByTestId('event-log')).toBeVisible();

		// Following survives the move: the control is still lit on the board.
		await expect(live).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('follow-banner')).toBeVisible();

		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSync: true, autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

		const filed = `Filed while popped out ${Date.now()}`;
		await fileFromElsewhere(page, filed);

		// The board moves, though the log doing the following is elsewhere.
		await expect(ticketPanel).toContainText(filed, {timeout: 20_000});

		expect(pageErrors).toEqual([]);
	} finally {
		// In the finally, so a stray `/log` page never leaks into later tests.
		await popout?.close();
		fs.writeFileSync(configPath, original);
	}
});

// A scrub snaps the log to its foot programmatically, so `onScroll` reports
// nothing; the board must not keep an earlier unpinned state.
test('scrubbing and coming back leaves the log able to follow', async ({
	page,
	appUrl,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		await page.setViewportSize({width: 1100, height: 300});
		await page.goto(appUrl);
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		await page.getByTestId('add-issue').first().click();
		await page.getByPlaceholder('ticket name').fill('Still here afterwards');
		await page.getByPlaceholder('ticket name').press('Enter');

		const ticketPanel = page
			.locator('aside')
			.filter({hasNot: page.getByTestId('event-log-header')});
		await expect(ticketPanel).toContainText('Still here afterwards');

		const live = page.getByTestId('live-toggle');
		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		const PANE = `document.querySelector('[data-testid="event-log"] .epiq-log-pane')`;
		// As above: the pane is not there the instant the toggle is pressed.
		await expect(
			page.getByTestId('event-log').locator('.epiq-log-pane'),
		).toHaveCount(1);
		await expect
			.poll(
				async () =>
					(await page.evaluate(
						`${PANE}.scrollHeight - ${PANE}.clientHeight`,
					)) as number,
			)
			.toBeGreaterThan(36);

		// Read back: following pauses and the board records an unpinned pane.
		await page.evaluate(
			`${PANE}.scrollTop = 0; ${PANE}.dispatchEvent(new Event('scroll', {bubbles: true}));`,
		);

		// Into the past and back. Each move of the moment snaps the pane to its
		// foot, which is the pin nobody reports unless this is right.
		const track = await trackWithWindow(page);
		const box = await track.boundingBox();
		if (!box) throw new Error('scrubber track is not on screen');
		await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);
		// In the past before coming back: the checkout is a round trip, and
		// returnToLive takes a board with no "Now" button for one already live.
		await expect(
			page.getByRole('button', {name: 'Now', exact: true}),
		).toBeEnabled();
		await returnToLive(page);

		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSync: true, autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

		const filed = `Filed after a scrub ${Date.now()}`;
		await fileFromElsewhere(page, filed);

		await expect(ticketPanel).toContainText(filed, {timeout: 20_000});

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});
