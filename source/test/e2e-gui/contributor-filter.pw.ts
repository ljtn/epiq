import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

test('the Contributors list narrows the board to who caused an event on a ticket', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const boardUrl = page.url();
	const touched = `Touched ${Date.now()}`;
	await addTicket(page, touched);

	// Back to the board, so the window certainly holds the event that created
	// it: the axis reads the timeline, not the board state.
	await page.goto(boardUrl);
	await expect(card(page, touched)).toBeVisible();

	await page.getByRole('button', {name: 'Board events'}).click();
	await page.getByRole('checkbox', {name: 'Contributors'}).click();
	await page
		.getByRole('button', {name: 'Pick which contributors to show'})
		.click();

	// The Contributors list is the actor behind every kind of event, not just
	// the author of a comment. Switched on with everyone under it the axis asks
	// only that a ticket have been touched at all — which this one has.
	await expect(page).toHaveURL(/only=actor/);
	await expect(card(page, touched)).toBeVisible();

	// Unticking the only contributor there is leaves the axis with nobody, so
	// it switches off rather than emptying the board.
	const person = page
		.getByRole('group', {name: 'Which contributors to show'})
		.getByRole('checkbox')
		.first();
	await expect(person).toBeChecked();
	// Clicked rather than unchecked: the input is React-controlled, so its DOM
	// property trails the render answering the click, and uncheck()'s own read
	// of it races that.
	await person.click();

	await expect(page).not.toHaveURL(/only=/);
	await expect(card(page, touched)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
