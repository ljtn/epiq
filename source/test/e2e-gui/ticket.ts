import {expect} from './fixtures.js';
import type {Page} from '@playwright/test';

/**
 * Files a ticket on the board on screen and waits for its own details, not
 * just any `/issue/` url, which the previous ticket would satisfy.
 */
export const addTicket = async (page: Page, title: string) => {
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill(title);
	await page.getByPlaceholder('ticket name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

/**
 * The same, returning the ref from the panel's copy button (scoped to `aside`;
 * `TooltipLayer` strips titles).
 */
export const addTicketForRef = async (
	page: Page,
	title: string,
): Promise<string> => {
	await addTicket(page, title);

	const ref = (
		await page.locator('aside').getByTestId('copy-ref').first().textContent()
	)?.trim();

	expect(ref).toBeTruthy();

	return ref!;
};
