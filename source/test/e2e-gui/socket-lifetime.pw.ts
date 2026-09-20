// 8GXKQR4: one socket for the session, whichever board is on screen.
//
// The board boots at `/` and redirects to the first board a moment later, and
// the socket used to be keyed on that board — so the redirect replaced it. A
// request in flight across the swap lost its reply, which is not a dropped
// frame anybody sees: the ticket was created, the broadcast drew its card, and
// `issues:create:result` came back to a socket that had already gone, so the
// panel it was supposed to open never did.
//
// Counting the sockets rather than racing that window: the swap is what the
// lost reply is made of, and it is the thing that must not happen.

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

	// The redirect the app makes for itself, which is the swap that used to
	// cost a socket. Waiting for it rather than for the switcher's text: the
	// board on screen falls back to the first one before the route names it.
	await expect(page).toHaveURL(/\/board\/[^/]+$/);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	expect(opened).toHaveLength(1);

	await switchToBoard(page, 'QA');
	await switchToBoard(page, 'Default');

	expect(opened).toHaveLength(1);
	expect(pageErrors).toEqual([]);
});

// The other half of one socket outliving a board switch: a reply that arrives
// after the reader has moved on. `issues:create:result` is what opens a filed
// ticket, and the ticket belongs to the board it was filed on — so obeying a
// late one would take the reader off the board they just moved to, to a ticket
// it does not hold. The swap used to discard it for us.
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
		.getByPlaceholder('issue name')
		.fill(`Filed then left ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	await switchToBoard(page, 'QA');

	// Long enough for the held reply to have landed and been ignored.
	await page.waitForTimeout(HELD_MS + 500);

	await expect(page.getByTestId('board-switcher')).toContainText('QA');
	await expect(page).not.toHaveURL(/\/issue\//);

	expect(pageErrors).toEqual([]);
});
