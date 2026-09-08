import {expect, test} from './fixtures.js';

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// The point of the layer: a control nobody wrapped still gets the app's own
// tooltip, because it still writes a plain `title`.
test('an ordinary title gets the app tooltip, not the browser one', async ({
	page,
	pageErrors,
}) => {
	await page.getByTitle('Add issue').first().hover();

	const tip = page.getByTestId('tooltip');
	await expect(tip).toHaveText('Add issue');

	// Portalled out, or a column's own `overflow: hidden` would cut it off.
	await expect(
		page.evaluate(
			`document.querySelector('[data-testid="tooltip"]').parentElement === document.body`,
		),
	).resolves.toBe(true);

	expect(pageErrors).toEqual([]);
});

// The attribute has to come off to stop the browser drawing its own bubble on
// top, which makes putting it back the part that can silently break — every
// `getByTitle` in this suite depends on it.
test('the title attribute is given back when the pointer leaves', async ({
	page,
	pageErrors,
}) => {
	const add = page.getByTitle('Add issue').first();
	await add.hover();
	await expect(page.getByTestId('tooltip')).toBeVisible();

	await page.getByTestId('board-switcher').hover();
	await expect(page.getByTestId('tooltip')).toHaveCount(0);

	await expect(page.getByTitle('Add issue').first()).toBeVisible();
	await expect(
		page.evaluate(`document.querySelectorAll('[data-epiq-tip]').length`),
	).resolves.toBe(0);

	expect(pageErrors).toEqual([]);
});

test('a keypress dismisses it', async ({page, pageErrors}) => {
	await page.getByTitle('Add issue').first().hover();
	await expect(page.getByTestId('tooltip')).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('tooltip')).toHaveCount(0);

	// And the attribute survives that route out too.
	await expect(page.getByTitle('Add issue').first()).toBeVisible();

	expect(pageErrors).toEqual([]);
});
