import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Long enough to clear the clamp several times over on any window this suite
// runs in, so the test is measuring the clamp rather than the viewport.
const LONG_DESCRIPTION = Array.from(
	{length: 60},
	(_, index) => `paragraph ${index}`,
).join('\n\n');

const openTicketWithDescription = async (
	page: Page,
	appUrl: string,
	description: string,
) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Overflow ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);

	await page.getByRole('button', {name: 'edit'}).first().click();
	const box = page.getByRole('textbox').last();
	await box.fill(description);
	await box.press('ControlOrMeta+Enter');

	await expect(page.getByTestId('description-box')).toBeVisible();
};

const descriptionHeight = async (page: Page): Promise<number> => {
	const size = await page.getByTestId('description-box').boundingBox();

	return size?.height ?? 0;
};

// Every element inside the description that can be scrolled up and down. The
// aside is the one scroller for this region; anything here is a second bar
// inside it. Horizontal scrollers are left alone — a wide code block gets one,
// and `overflow-x: auto` makes the computed `overflow-y` read `auto` too.
const verticalScrollersInDescription = async (page: Page): Promise<number> =>
	(await page.evaluate(`
(() => {
	const box = document.querySelector('[data-testid="description-box"]');

	return [box, ...box.querySelectorAll('*')]
		.filter(element => element.scrollHeight - element.clientHeight > 2)
		.filter(element => {
			const overflowY = getComputedStyle(element).overflowY;

			return overflowY === 'auto' || overflowY === 'scroll';
		}).length;
})()
`)) as number;

test('a long description is clamped with a show more, not a second scrollbar', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicketWithDescription(page, appUrl, LONG_DESCRIPTION);

	// First, because it is the regression: the description used to answer a
	// long body with a scrollbar of its own, inside the aside's.
	expect(await verticalScrollersInDescription(page)).toBe(0);

	const showMore = page
		.getByTestId('description-box')
		.getByTestId('description-show-more');
	await expect(showMore).toHaveText('show more');

	const clamped = await descriptionHeight(page);
	expect(clamped).toBeLessThan(420);

	await showMore.click();

	await expect(showMore).toHaveText('show less');
	expect(await descriptionHeight(page)).toBeGreaterThan(clamped);
	await expect(page.getByTestId('description-box')).toContainText(
		'paragraph 59',
	);
	expect(await verticalScrollersInDescription(page)).toBe(0);

	// And back, so the rest of the aside is reachable again without a reload.
	await showMore.click();
	await expect(showMore).toHaveText('show more');
	expect(await descriptionHeight(page)).toBe(clamped);

	expect(pageErrors).toEqual([]);
});

test('a short description has no show more at all', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicketWithDescription(page, appUrl, 'one line');

	await expect(page.getByTestId('description-box')).toContainText('one line');
	await expect(
		page.getByTestId('description-box').getByTestId('description-show-more'),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
