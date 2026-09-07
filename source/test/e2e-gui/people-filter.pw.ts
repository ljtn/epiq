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

test('the People list narrows the board to who caused an event on a ticket', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const touched = `Touched ${Date.now()}`;
	await addTicket(page, touched);
	await expect(card(page, touched)).toBeVisible();

	await page.getByRole('button', {name: 'Board events'}).click();
	await page.getByRole('radio', {name: 'Tags'}).click();
	await page.getByRole('button', {name: 'Pick which people to show'}).click();

	// The People list is the actor behind every kind of event, not just the
	// author of a comment, so unticking the lot leaves no ticket anybody has
	// touched. Clicked rather than unchecked: the input is React-controlled, so
	// its DOM property trails the render answering the click, and uncheck()'s
	// own read of it races that.
	const person = page.getByRole('radiogroup').getByRole('checkbox').first();
	await expect(person).toBeChecked();
	await person.click();

	await expect(page).toHaveURL(/only=actor/);
	await expect(card(page, touched)).toHaveCount(0);
	// The chart is still plotting tags: narrowing People filtered the board
	// under it without taking the series away.
	await expect(page).toHaveURL(/view=tagging/);

	await person.click();
	await expect(card(page, touched)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
