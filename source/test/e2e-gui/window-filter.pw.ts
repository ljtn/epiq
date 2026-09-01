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

const HOUR_MS = 60 * 60 * 1000;

// A dragged-out window, which is the only kind with fixed bounds — every other
// is anchored to now, and a stretch that is over is what makes the filter say
// something.
const zoomed = (boardUrl: string, from: number, to: number) =>
	`${boardUrl}?window=1&from=${from}&to=${to}`;

test('the scope filter narrows the board to what the window holds, and lets go again', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();
	const scopeOnly = page.getByRole('checkbox', {name: 'Scope only'});

	// Under "All" the window is the whole log, so there is nothing to narrow.
	await expect(scopeOnly).toBeDisabled();

	const title = `Windowed ${Date.now()}`;
	await addTicket(page, title);

	const now = Date.now();

	// A window the ticket was filed inside: narrowed, and still there.
	await page.goto(zoomed(boardUrl, now - HOUR_MS, now + HOUR_MS));
	await expect(scopeOnly).toBeChecked();
	await expect(card(page, title)).toBeVisible();
	// The timeline is outlined while it is the thing doing the hiding.
	await expect(page.getByTestId('scrubber-track')).toHaveCSS(
		'outline-style',
		'solid',
	);

	// A stretch that ended before the repository existed holds no event, so it
	// holds no ticket either.
	await page.goto(zoomed(boardUrl, now - 3 * HOUR_MS, now - 2 * HOUR_MS));
	await expect(card(page, title)).toHaveCount(0);

	// And the way back out is the box itself: a quiet window must not leave it
	// disabled over an empty board.
	await expect(scopeOnly).toBeEnabled();
	await scopeOnly.click();
	await expect(card(page, title)).toBeVisible();
	await expect(page).not.toHaveURL(/window=1/);
	await expect(page.getByTestId('scrubber-track')).not.toHaveCSS(
		'outline-style',
		'solid',
	);

	// Ticked again on the same page, the ticket goes away a second time — so
	// the empty board above was the filter and not a board still loading.
	await scopeOnly.click();
	await expect(card(page, title)).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
