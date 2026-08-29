import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const postComment = async (page: Page, text: string) => {
	await page.getByPlaceholder('write a comment').fill(text);
	await page.getByRole('button', {name: 'comment', exact: true}).click();
	await expect(page.locator('aside').getByText(text)).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('your own comment can be edited and deleted', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Own comment ${Date.now()}`);
	await page.getByRole('button', {name: /^Comments/}).click();
	await postComment(page, 'first draft');
	await expect(page.getByRole('button', {name: 'Comments (1)'})).toBeVisible();

	// Edit: the body is prefilled, Escape backs out untouched.
	await page.getByTitle('Edit comment').click();
	const editor = page.locator('aside textarea').first();
	await expect(editor).toHaveValue('first draft');
	await editor.press('Escape');
	await expect(page.locator('aside').getByText('first draft')).toBeVisible();

	await page.getByTitle('Edit comment').click();
	await editor.fill('second draft');
	await page.getByRole('button', {name: 'save'}).click();
	await expect(page.locator('aside').getByText('second draft')).toBeVisible();
	await expect(page.locator('aside').getByText('first draft')).toHaveCount(0);

	// Survives a reload: it reached the log, not just the screen.
	await page.reload();
	await expect(page.locator('aside').getByText('second draft')).toBeVisible();

	// Delete.
	await page.getByTitle('Delete comment').click();
	await expect(page.locator('aside').getByText('second draft')).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Comments (0)'})).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', {name: 'Comments (0)'})).toBeVisible();

	expect(pageErrors).toEqual([]);
});
