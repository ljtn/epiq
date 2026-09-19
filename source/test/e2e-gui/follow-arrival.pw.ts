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
