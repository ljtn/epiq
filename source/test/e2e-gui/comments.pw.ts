import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const postComment = async (page: Page, text: string) => {
	await page.getByPlaceholder('write a comment').fill(text);
	await page.getByRole('button', {name: 'Comment', exact: true}).click();
	await expect(page.locator('aside').getByText(text)).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// The step to take next is lit in the accent; one not yet available is not.
test('the comment button lights once there is something to send', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Lit comment ${Date.now()}`);
	await page.getByRole('button', {name: /^Comments/}).click();
	const send = page.getByTestId('comment-send');

	await expect(send).toBeDisabled();
	await expect(send).toHaveCSS('color', 'rgb(127, 138, 163)');

	await page.getByPlaceholder('write a comment').fill('   ');
	await expect(send).toBeDisabled();

	await page.getByPlaceholder('write a comment').fill('ready');
	await expect(send).toBeEnabled();
	await expect(send).toHaveCSS('color', 'rgb(118, 212, 255)');

	expect(pageErrors).toEqual([]);
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
	await page.getByTestId('edit-comment').click();
	const editor = page.locator('aside textarea').first();
	await expect(editor).toHaveValue('first draft');
	await editor.press('Escape');
	await expect(page.locator('aside').getByText('first draft')).toBeVisible();

	await page.getByTestId('edit-comment').click();
	await editor.fill('second draft');
	await page.getByRole('button', {name: 'save'}).click();
	await expect(page.locator('aside').getByText('second draft')).toBeVisible();
	await expect(page.locator('aside').getByText('first draft')).toHaveCount(0);

	// Survives a reload: it reached the log, not just the screen.
	await page.reload();
	await expect(page.locator('aside').getByText('second draft')).toBeVisible();

	// Delete.
	await page.getByTestId('delete-comment').click();
	await expect(page.locator('aside').getByText('second draft')).toHaveCount(0);
	await expect(page.getByRole('button', {name: 'Comments (0)'})).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', {name: 'Comments (0)'})).toBeVisible();

	expect(pageErrors).toEqual([]);
});
