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

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const switchToBoard = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: name})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
};

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
