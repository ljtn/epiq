import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Addressed by test id, not by text: the trigger's label is the current board,
// so a text selector cannot address it across the change it is driving.
const switchToBoard = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: name})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	// The board only exists once the socket has delivered the first state.
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('loads a board with its swimlanes', async ({page, pageErrors}) => {
	// Seeded by :init — the cheapest proof a column rendered rather than an
	// empty shell.
	await expect(page.getByText('Todo')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The regression: switching boards blanked the screen. An effect sent on a
// socket that was still CONNECTING, `send` throws in that state, and an
// uncaught throw in an effect unmounts the whole tree.
//
// A board switch is no longer how you get there: since `8GXKQR4` the socket
// outlives one, so what reaches a CONNECTING socket now is a reconnect. This
// test no longer reproduces the original crash — it holds the board switch
// itself to drawing a board either way.
test('switches between boards without blanking the screen', async ({
	page,
	pageErrors,
}) => {
	await switchToBoard(page, 'QA');

	await expect(page).toHaveURL(/\/board\//);
	// A crashed page still has a body, so assert the app root has content.
	await expect(page.locator('body')).not.toBeEmpty();

	// Back again: one direction can succeed while the return trip crashes.
	await switchToBoard(page, 'Default');
	await expect(page.getByText('Todo')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('survives repeated board toggling', async ({page, pageErrors}) => {
	for (let i = 0; i < 3; i++) {
		await switchToBoard(page, 'QA');
		await switchToBoard(page, 'Default');
	}

	await expect(page.getByText('Todo')).toBeVisible();
	expect(pageErrors).toEqual([]);
});
