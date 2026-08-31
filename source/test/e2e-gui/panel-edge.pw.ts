import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

test.use({viewport: {width: 1600, height: 900}});

const openTicket = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Edge ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toBeVisible();
};

const dockTo = async (page: Page, side: 'bottom' | 'right') => {
	await page.getByTestId('panel-menu').click();
	await page.getByRole('button', {name: `Dock to ${side}`}).click();
};

// Passed as a source string, not a closure: the root tsconfig has no DOM lib.
// Reports the edge facing the board — the left border when the panel is docked
// right, the top border when it is docked bottom — as its alpha, and whether a
// shadow is cast along it.
const edge = (page: Page, side: 'bottom' | 'right') =>
	page.evaluate<{alpha: number; shadow: string}>(`
		(() => {
			const style = getComputedStyle(document.querySelector('aside'));
			const color = ${side === 'bottom'}
				? style.borderTopColor
				: style.borderLeftColor;
			const parts = color.match(/[\\d.]+/g) ?? [];

			return {
				alpha: parts.length > 3 ? Number(parts[3]) : 1,
				shadow: style.boxShadow,
			};
		})()
	`);

test('the panel edge is drawn strongly enough to separate it from the board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);

	// The section rule inside the panel is 0.15, which was the edge too and is
	// what made the panel hard to pick out. Anything at that strength fails.
	const right = await edge(page, 'right');
	expect(right.alpha).toBeGreaterThan(0.4);
	expect(right.shadow).not.toBe('none');

	await dockTo(page, 'bottom');

	const bottom = await edge(page, 'bottom');
	expect(bottom.alpha).toBeGreaterThan(0.4);
	expect(bottom.shadow).not.toBe('none');

	expect(pageErrors).toEqual([]);
});
