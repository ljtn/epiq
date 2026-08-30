import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('entering fullscreen lays the panel out for its full width in the same frame', async ({
	page,
	pageErrors,
}) => {
	await page.setViewportSize({width: 1600, height: 900});
	await addTicket(page, `Frame ${Date.now()}`);
	await expect(page.getByTestId('lane-overview')).toHaveCount(0);

	// Observes the panel going fullscreen and reads the layout in that same
	// commit: the lanes must already be there, not arrive a render later after
	// a frame of tabs stretched across the window.
	const lanesWhenFullscreen = await page.evaluate(`
new Promise(resolve => {
	const aside = document.querySelector('aside');
	const observer = new MutationObserver(() => {
		if (getComputedStyle(aside).position !== 'absolute') return;
		observer.disconnect();
		resolve(document.querySelectorAll('[data-testid="lane-overview"]').length);
	});
	observer.observe(aside, {attributes: true, attributeFilter: ['style']});
	aside.querySelector('button[title="Fullscreen"]').click();
})
`);
	expect(lanesWhenFullscreen).toBe(1);
	await expect(page.getByTestId('lane-overview')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
