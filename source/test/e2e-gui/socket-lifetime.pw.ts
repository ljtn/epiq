// One socket for the session, whichever board is on screen: a swap would lose
// replies in flight. Counts sockets rather than racing that window.

import {expect, test} from './fixtures.js';
import {switchToBoard} from './board-switcher.js';

test('one socket survives the redirect off / and a board switch', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const opened: string[] = [];
	page.on('websocket', ws => opened.push(ws.url()));

	await page.goto(appUrl);

	// The app's own redirect; the switcher's text falls back to the first board before it.
	await expect(page).toHaveURL(/\/board\/[^/]+$/);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	expect(opened).toHaveLength(1);

	await switchToBoard(page, 'QA');
	await switchToBoard(page, 'Default');

	expect(opened).toHaveLength(1);
	expect(pageErrors).toEqual([]);
});

// A create reply that arrives after a board switch must not open its ticket.
test('a ticket filed just before a board switch does not drag the reader back', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const HELD_MS = 1500;

	// Held rather than raced: the window is the point, so the test makes one
	// instead of hoping for it.
	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => server.send(message));
		server.onMessage(async message => {
			if (
				typeof message === 'string' &&
				message.includes('"issues:create:result"')
			) {
				await new Promise(resolve => setTimeout(resolve, HELD_MS));
			}

			ws.send(message);
		});
	});

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('add-issue').first().click();
	await page
		.getByPlaceholder('ticket name')
		.fill(`Filed then left ${Date.now()}`);
	await page.getByPlaceholder('ticket name').press('Enter');

	await switchToBoard(page, 'QA');

	// Long enough for the held reply to have landed and been ignored.
	await page.waitForTimeout(HELD_MS + 500);

	await expect(page.getByTestId('board-switcher')).toContainText('QA');
	await expect(page).not.toHaveURL(/\/issue\//);

	expect(pageErrors).toEqual([]);
});
