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
	const editor = page.getByTestId('comment-editor');
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

// "2 min ago" says when roughly; the hover says exactly.
test('the age on a comment holds its full date for the hover', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Comment date ${Date.now()}`);
	await page.getByRole('button', {name: /^Comments/}).click();
	await postComment(page, 'dated');

	const age = page.getByTestId('comment-created-at');
	await expect(age).toHaveText(/ago|just now/);
	await expect(age).toHaveAttribute(
		'title',
		new RegExp(String(new Date().getFullYear())),
	);

	expect(pageErrors).toEqual([]);
});

// Taller than the panel, so the thread scrolls.
const postLongThread = async (page: Page, prefix: string) => {
	for (const n of [1, 2, 3, 4]) {
		await postComment(page, `${prefix} ${n}\n${'line\n'.repeat(15)}end ${n}`);
	}
};

// Read top to bottom: the newest comment ends the thread, the composer under it.
test('a thread opens at its end, the composer under the newest comment', async ({
	page,
	pageErrors,
}) => {
	const prefix = `Thread end ${Date.now()}`;
	await addTicket(page, prefix);
	await page.getByRole('button', {name: /^Comments/}).click();
	await postLongThread(page, prefix);

	await page.reload();
	await page.getByRole('button', {name: /^Comments/}).click();
	const oldest = page.locator('aside').getByText(`${prefix} 1`);
	const newest = page.locator('aside').getByText(`end 4`);
	await expect(newest).toBeInViewport();
	await expect(oldest).not.toBeInViewport();

	const composer = await page.getByTestId('comment-composer').boundingBox();
	expect(composer!.y).toBeGreaterThan((await newest.boundingBox())!.y);

	expect(pageErrors).toEqual([]);
});

// Scrolled up to read, a reply still needs no scroll back down.
test('the composer and tabs stay in view over a scrolled thread', async ({
	page,
	pageErrors,
}) => {
	const prefix = `Thread scrolled ${Date.now()}`;
	await addTicket(page, prefix);
	await page.getByRole('button', {name: /^Comments/}).click();
	await postLongThread(page, prefix);

	await page.evaluate(
		`document.querySelector('[data-testid="tab-scroll"]').scrollTop = 0`,
	);
	await expect(page.locator('aside').getByText(`${prefix} 1`)).toBeInViewport();
	await expect(page.getByTestId('comment-composer')).toBeInViewport();
	await expect(page.getByRole('button', {name: /^Comments/})).toBeInViewport();

	expect(pageErrors).toEqual([]);
});
