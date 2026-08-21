import {expect, test} from './fixtures.js';

const scatterPressed = (page: import('@playwright/test').Page) =>
	page.getByTitle(/^Events —/);

test('the chart layout survives a reload', async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Volume is the default, so the scatter is the one worth persisting.
	await expect(page.getByTestId('scatter-canvas')).toHaveCount(0);

	await scatterPressed(page).click();
	await expect(page.getByTestId('scatter-canvas')).toBeVisible();

	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('scatter-canvas')).toBeVisible();

	// And back, so the stored value tracks the choice rather than sticking.
	await page.getByTitle(/^Volume —/).click();
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('scatter-canvas')).toHaveCount(0);
});
