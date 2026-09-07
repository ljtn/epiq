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

const tagOpenTicket = async (page: Page, tag: string) => {
	await page
		.locator('aside')
		.getByRole('button', {name: '+', exact: true})
		.first()
		.click();
	await page.getByPlaceholder('tag name').fill(tag);
	await page.getByPlaceholder('tag name').press('Enter');
	await expect(page.locator('aside')).toContainText(tag);
};

test('a narrowing survives the chart being pointed somewhere else', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const tagged = `Tagged ${stamp}`;
	const plain = `Plain ${stamp}`;
	const tag = `t${stamp}`;

	await addTicket(page, tagged);
	await tagOpenTicket(page, tag);
	await addTicket(page, plain);

	await page.goto(boardUrl);
	await card(page, tagged)
		.getByTestId('ticket-tag')
		.filter({hasText: tag})
		.click();
	await expect(card(page, plain)).toHaveCount(0);

	// The narrowing belongs to the tag axis, not to whatever the chart happens
	// to be plotting, so choosing another series leaves the board where it is.
	await page.getByRole('button', {name: /^Tags/}).click();
	await page.getByRole('radio', {name: 'Comments'}).click();

	await expect(page).toHaveURL(/view=comments/);
	await expect(page).toHaveURL(/only=tag/);
	await expect(card(page, tagged)).toBeVisible();
	await expect(card(page, plain)).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('opening a row list leaves the plotted series alone', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByRole('button', {name: 'Board events'}).click();
	await page.getByRole('radio', {name: 'Tags'}).click();

	// The caret opens that axis's list without selecting its row, which is the
	// whole point of a list per axis: narrow by one while the chart plots
	// another.
	await page.getByRole('button', {name: 'Pick which to show'}).first().click();
	await expect(page.getByRole('radio', {name: 'Tags'})).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await expect(page.getByRole('radio', {name: 'Comments'})).toHaveAttribute(
		'aria-checked',
		'false',
	);

	expect(pageErrors).toEqual([]);
});
