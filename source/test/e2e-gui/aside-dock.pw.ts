import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Wide enough that a bottom dock earns the lanes without fullscreen.
test.use({viewport: {width: 1600, height: 900}});

const openTicket = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Dock ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toBeVisible();
};

const dockTo = async (page: Page, side: 'bottom' | 'right') => {
	await page.getByTestId('panel-menu').click();
	await page.getByRole('button', {name: `Dock to ${side}`}).click();
};

// Passed as a source string, not a closure: the root tsconfig has no DOM lib.
const edges = (page: Page) =>
	page.evaluate<{
		asideTop: number;
		asideLeft: number;
		mainBottom: number;
		mainRight: number;
	}>(`
		(() => {
			const main = document.querySelector('main');
			const aside = document.querySelector('aside');
			const m = main.getBoundingClientRect();
			const a = aside.getBoundingClientRect();

			return {
				asideTop: Math.round(a.top),
				asideLeft: Math.round(a.left),
				mainBottom: Math.round(m.bottom),
				mainRight: Math.round(m.right),
			};
		})()
	`);

test('the panel moves under the board and back beside it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);

	// Docked right: the board ends where the panel begins, horizontally.
	const beside = await edges(page);
	expect(beside.mainRight).toBe(beside.asideLeft);

	await dockTo(page, 'bottom');

	// Docked bottom: the same seam, rotated. The board now runs full width.
	await expect.poll(async () => (await edges(page)).asideLeft).toBe(0);
	const under = await edges(page);
	expect(under.mainBottom).toBe(under.asideTop);

	await dockTo(page, 'right');
	await expect
		.poll(async () => (await edges(page)).asideLeft)
		.toBeGreaterThan(0);

	expect(pageErrors).toEqual([]);
});

// The lanes are about how wide the panel is, and a bottom dock is window-wide
// by construction — so it earns them without going fullscreen first.
test('a bottom dock shows the lanes without fullscreen', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);

	await expect(page.getByTestId('lane-overview')).toHaveCount(0);

	await dockTo(page, 'bottom');

	await expect(page.getByTestId('lane-overview')).toBeVisible();
	await expect(page.getByTestId('lane-commits')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('the dock side survives a reload', async ({page, appUrl, pageErrors}) => {
	await openTicket(page, appUrl);
	await dockTo(page, 'bottom');
	await expect(page.getByTestId('lane-overview')).toBeVisible();

	await page.reload();
	await expect(page.locator('aside')).toBeVisible();

	await expect.poll(async () => (await edges(page)).asideLeft).toBe(0);

	expect(pageErrors).toEqual([]);
});

// Docked bottom the handle moves to the top edge and the drag runs vertically:
// dragging it up toward the timeline is what grows the panel.
test('a bottom dock resizes vertically from its top edge', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);
	await dockTo(page, 'bottom');
	await expect(page.getByTestId('lane-overview')).toBeVisible();

	const before = await page.locator('aside').boundingBox();
	if (!before) throw new Error('panel is not on screen');

	await page.mouse.move(800, before.y + 1);
	await page.mouse.down();
	await page.mouse.move(800, before.y - 150, {steps: 12});
	await page.mouse.up();

	const after = await page.locator('aside').boundingBox();
	if (!after) throw new Error('panel is not on screen');

	expect(after.height).toBeGreaterThan(before.height + 100);
	// It grew upward into the board rather than downward off the window.
	expect(Math.round(after.y + after.height)).toBe(
		Math.round(before.y + before.height),
	);

	expect(pageErrors).toEqual([]);
});
