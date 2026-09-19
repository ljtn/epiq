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

import fs from 'node:fs';
import path from 'node:path';
import {expect, readHandoff, test} from './fixtures.js';

const filedFromElsewhere = async (page: import('@playwright/test').Page) => {
	const title = `Filed from elsewhere ${Date.now()}`;

	await page.evaluate(async filed => {
		const socket = new WebSocket(`ws://${window.location.host}/ws`);
		const send = (body: unknown) => socket.send(JSON.stringify(body));
		const next = async (type: string) =>
			await new Promise<any>(resolve => {
				const handler = (event: MessageEvent) => {
					const message = JSON.parse(event.data);
					if (message.type !== type) return;
					socket.removeEventListener('message', handler);
					resolve(message);
				};
				socket.addEventListener('message', handler);
			});

		await new Promise(resolve => socket.addEventListener('open', resolve));

		const state = next('state');
		send({type: 'state:get'});
		const lane = (await state).payload?.value?.boards?.[0]?.swimlanes?.[0];

		const created = next('issues:create:result');
		send({type: 'issues:create', payload: {parentId: lane.id, title: filed}});
		await created;
	}, title);

	return title;
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
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSync: true, autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

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

		const filed = await filedFromElsewhere(page);

		// The board follows it. Generous, because this rides a real sync pass.
		await expect(ticketPanel).toContainText(filed, {timeout: 40_000});
		await expect(page.getByTestId('follow-banner')).toBeVisible();

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});
