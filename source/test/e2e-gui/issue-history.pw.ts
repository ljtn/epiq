import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const openFirstTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the log tab lists the ticket’s own events', async ({
	page,
	pageErrors,
}) => {
	const title = `History ${Date.now()}`;
	await openFirstTicket(page, title);

	await page.getByRole('button', {name: /^Log/}).click();

	const history = page.getByTestId('issue-history');
	await expect(history).toBeVisible();
	// Phrased by the same formatter the TUI log uses.
	await expect(history).toContainText(`Created with title "${title}"`);

	// A further change lands in the same list, newest first.
	await page.getByRole('button', {name: 'Overview'}).click();
	await page.getByRole('button', {name: 'close issue'}).click();

	await page.getByRole('button', {name: /^Log/}).click();
	await expect(history.locator('> div').first()).toContainText('Closed');
	await expect(history).toContainText('Created with title');

	expect(pageErrors).toEqual([]);
});

test('the overview names when the ticket was created', async ({page}) => {
	const title = `Created ${Date.now()}`;
	await openFirstTicket(page, title);

	const created = page.getByTestId('issue-created-at');
	await expect(created).toBeVisible();
	await expect(created).toContainText(/Created (just now|\d+\w+ ago)/);
	// The exact timestamp stays on hover rather than crowding the line.
	await expect(created).toHaveAttribute(
		'title',
		new RegExp(String(new Date().getFullYear())),
	);
});

test('the log tab survives a reload on its own url', async ({page}) => {
	const title = `Deep link ${Date.now()}`;
	await openFirstTicket(page, title);

	await page.getByRole('button', {name: /^Log/}).click();
	await expect(page).toHaveURL(/tab=history/);

	await page.reload();
	await expect(page.getByTestId('issue-history')).toBeVisible();
});
