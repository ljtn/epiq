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

test('typing in the text filter narrows the board by title or ref, and Escape clears it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const apple = `Apple ${stamp}`;
	const banana = `Banana ${stamp}`;

	await addTicket(page, apple);
	await addTicket(page, banana);

	await page.goto(boardUrl);
	await expect(card(page, apple)).toBeVisible();
	await expect(card(page, banana)).toBeVisible();

	const bananaRef = (
		await card(page, banana).locator('button[title^="Copy "]').textContent()
	)?.trim();
	expect(bananaRef).toMatch(/^[A-Z0-9]{7}$/);

	const filter = page.getByTestId('text-filter');

	// By title, ignoring case.
	await filter.fill(`apple ${stamp}`);
	await expect(card(page, banana)).toHaveCount(0);
	await expect(card(page, apple)).toBeVisible();

	// By ref, ignoring case.
	await filter.fill(bananaRef!.toLowerCase());
	await expect(card(page, apple)).toHaveCount(0);
	await expect(card(page, banana)).toBeVisible();

	// Escape empties the box and brings everything back.
	await filter.press('Escape');
	await expect(filter).toHaveValue('');
	await expect(card(page, apple)).toBeVisible();
	await expect(card(page, banana)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
