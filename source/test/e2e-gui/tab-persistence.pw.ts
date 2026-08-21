import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
};

const openFromBoard = async (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title}).first().click();

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the open tab carries across ticket selections', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const first = `Tab A ${stamp}`;
	const second = `Tab B ${stamp}`;

	await addTicket(page, first);
	await addTicket(page, second);

	await page.getByRole('button', {name: /^Comments/}).click();
	await expect(page).toHaveURL(/tab=comments/);

	await openFromBoard(page, first);
	await expect(page).toHaveURL(/tab=comments/);
	await expect(page.getByPlaceholder(/comment/i)).toBeVisible();

	// Any tab, not just comments.
	await page.getByRole('button', {name: /^Log/}).click();
	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=history/);
	await expect(page.getByTestId('issue-history')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('the comment count on a card still opens comments', async ({page}) => {
	const title = `Count ${Date.now()}`;
	await addTicket(page, title);

	await page.getByRole('button', {name: /^Comments/}).click();
	await page.getByPlaceholder(/comment/i).fill('a remark');
	await page.getByRole('button', {name: 'comment', exact: true}).click();
	await expect(page.getByText('a remark')).toBeVisible();

	// Back to overview, then in through the card's comment count.
	await page.getByRole('button', {name: 'Overview'}).click();
	await expect(page).toHaveURL(/tab=overview/);

	await page
		.locator('[draggable="true"]')
		.filter({hasText: title})
		.getByTitle(/comment/i)
		.click();

	await expect(page).toHaveURL(/tab=comments/);
});
