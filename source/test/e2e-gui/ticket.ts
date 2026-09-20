import {expect} from './fixtures.js';
import type {Page} from '@playwright/test';

/**
 * Files a ticket on the board on screen, and waits for its panel.
 *
 * Nineteen spec files had written this out for themselves, byte for byte.
 *
 * Waits for this ticket's own details, not just any `/issue/` url: creation
 * navigates to the new ticket, and a url left over from the previous one would
 * satisfy the looser check while that navigation is still in flight — landing
 * later and resetting the tab.
 */
export const addTicket = async (page: Page, title: string) => {
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

/**
 * The same, handing back the new ticket's ref.
 *
 * Read from the panel's own copy button rather than by title: `TooltipLayer`
 * strips `title` while it is open, so a title selector addresses the wrong
 * element or none. Scoped to the `aside` because every card on the board
 * carries a `copy-ref` of its own.
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
