// The wiring following exists for: a write from somewhere else moves the
// board. Everything in `log-follow.pw.ts` passes with the feature deleted —
// this is the case that does not.
//
// The write comes from a socket of the test's own, so the board under test is
// not the client that made it. An ordinary mutation is answered by
// `sendStateAfterMutation` to the mutating socket alone — only time travel
// broadcasts — so a follower hears about it when the autosync pass next
// broadcasts, which is the path an agent's write takes too.
//
// The seed leaves autosync off, since a suite that only exercises the interface
// wants no background git work behind it. This one case turns it on for itself
// and puts it back: `queueSync` re-reads the config on every call and a
// mutation is what calls it, so the flag can be flipped under a running server.
//
// The config is the worker's, shared with every other file assigned to it, so
// the window it is on for is kept as short as the case allows — flipped
// immediately before the write and restored in a `finally`. A hard worker
// crash would skip that and leave it on for whatever runs next, which is the
// one hole here; an assertion failure would not.

import fs from 'node:fs';
import path from 'node:path';
import {expect, readHandoff, test} from './fixtures.js';
import {returnToLive} from './live-board.js';

// Passed as a string, not a typed callback: the root tsconfig has no DOM lib,
// so `window` inside `page.evaluate` does not typecheck — which is why every
// other file here that opens a socket from the page does the same.
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
		await page.getByPlaceholder('issue name').fill('The ticket being read');
		await page.getByPlaceholder('issue name').press('Enter');

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

// The second-monitor case: the log on a screen of its own, opening each ticket
// on the board as it arrives. Following is decided on the board's side for
// both panels, so popping the log out must not stop it — it did, before
// `VC8X5Q5`, because the effect lived in whichever panel happened to be drawn.
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
		// Short, so the seeded log overflows its pane and can actually be read
		// back through: at the default height it does not scroll at all, and the
		// step below would be a no-op that proved nothing.
		await page.setViewportSize({width: 1100, height: 300});

		await page.goto(appUrl);
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		await page.getByTestId('add-issue').first().click();
		await page.getByPlaceholder('issue name').fill('Read while popped out');
		await page.getByPlaceholder('issue name').press('Enter');

		const ticketPanel = page
			.locator('aside')
			.filter({hasNot: page.getByTestId('event-log-header')});
		await expect(ticketPanel).toContainText('Read while popped out');

		const live = page.getByTestId('live-toggle');
		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		// Read back first, which pauses following and leaves the board holding a
		// pin that belongs to a pane about to be unmounted. The popped-out panel
		// opens at its foot, and has to say so — from its own point of view
		// nothing changed, so it reports on the way in or following sits dead
		// behind the old pane's answer.
		// The pane counts itself pinned within two rows of its foot
		// (`PINNED_SLACK_PX` in EventLog, two 18px rows), so the room to scroll
		// has to exceed that — or reading back changes nothing and this case
		// quietly stops testing what it says it does.
		const pinnedSlackPx = 36;

		// As strings, for the same reason the write above is one: the root
		// tsconfig carries no DOM lib, so a typed callback cannot touch an
		// element's scroll geometry.
		const PANE = `document.querySelector('[data-testid="event-log"] .epiq-log-pane')`;

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
		// In the finally, not after the assertions: a failure above would
		// otherwise leak the window into the rest of the worker, where a stray
		// `/log` page can satisfy a later `waitForEvent('page')`.
		await popout?.close();
		fs.writeFileSync(configPath, original);
	}
});

// The other way a pane gets pinned without the reader scrolling: moving the
// board's moment snaps the log to its foot. That is a programmatic scroll, so
// `onScroll` sees the pin already true and reports nothing — and a board still
// holding the reader's earlier `false` would never follow again.
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
		await page.getByPlaceholder('issue name').fill('Still here afterwards');
		await page.getByPlaceholder('issue name').press('Enter');

		const ticketPanel = page
			.locator('aside')
			.filter({hasNot: page.getByTestId('event-log-header')});
		await expect(ticketPanel).toContainText('Still here afterwards');

		const live = page.getByTestId('live-toggle');
		await live.click();
		await expect(live).toHaveAttribute('aria-pressed', 'true');

		const PANE = `document.querySelector('[data-testid="event-log"] .epiq-log-pane')`;
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
		const track = page.getByTestId('scrubber-track');
		const box = await track.boundingBox();
		if (!box) throw new Error('scrubber track is not on screen');
		await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);
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
