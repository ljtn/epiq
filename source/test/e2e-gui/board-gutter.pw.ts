import {expect, test} from './fixtures.js';

test('the board runs flush to the details panel', async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Gutter ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.getByRole('button', {name: 'close issue'})).toBeVisible();

	// Any gap here is page background between a mid-card clip and the panel,
	// which reads as a dark strip down the panel's edge.
	// Passed as a source string, not a closure: the root tsconfig has no DOM
	// lib, and pulling one in would let Node code reach for browser globals.
	const edges = await page.evaluate<{rowRight: number; asideLeft: number}>(`
		(() => {
			const main = document.querySelector('main');
			const aside = document.querySelector('aside');
			const row = main.lastElementChild;

			return {
				rowRight: Math.round(row.getBoundingClientRect().right),
				asideLeft: Math.round(aside.getBoundingClientRect().left),
			};
		})()
	`);

	expect(edges.rowRight).toBe(edges.asideLeft);
});
