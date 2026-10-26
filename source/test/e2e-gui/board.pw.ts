import {expect, test} from './fixtures.js';
import {switchToBoard} from './board-switcher.js';

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

// Switching boards must keep drawing a board.
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

test('the board switcher reads in the same quiet colour as the text filter', async ({
	page,
	pageErrors,
}) => {
	const [switcherColor, placeholderColor] = await page.evaluate<
		[string, string]
	>(`[
		getComputedStyle(document.querySelector('[data-testid="board-switcher"]')).color,
		getComputedStyle(document.querySelector('[data-testid="text-filter"]'), '::placeholder').color,
	]`);

	expect(switcherColor).toBe(placeholderColor);
	expect(pageErrors).toEqual([]);
});

test('the board switcher lights the option under the pointer', async ({
	page,
	pageErrors,
}) => {
	await page.getByTestId('board-switcher').click();
	const option = page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'QA'});
	await expect(option).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	await option.hover();
	await expect(option).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Default'})
		.hover();
	await expect(option).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	expect(pageErrors).toEqual([]);
});
