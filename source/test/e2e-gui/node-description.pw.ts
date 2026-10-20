import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addLane = async (page: Page, name: string) => {
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(page.getByText(name)).toBeVisible();
};

const lane = (page: Page, name: string) =>
	page.locator('section').filter({hasText: name});

const deleteLane = async (page: Page, name: string) => {
	await lane(page, name).getByTestId('swimlane-menu').click();
	await page.getByTestId('swimlane-menu-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);
};

const openLanePanel = async (page: Page, name: string) => {
	await lane(page, name).getByTestId('swimlane-stats-open').click();
	await expect(page.getByTestId('swimlane-stats')).toContainText(name);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test("a lane's description is written in its panel, and marked on its header", async ({
	page,
	pageErrors,
}) => {
	const name = `Described ${Date.now()}`;
	await addLane(page, name);
	const marker = lane(page, name).getByTestId('swimlane-stats-open-marker');

	// Nothing to read yet, so nothing marked.
	await expect(marker).toHaveCount(0);

	await openLanePanel(page, name);
	await expect(page.getByTestId('swimlane-stats')).toContainText('Swimlane');
	await page.getByTestId('swimlane-description-edit').click();
	await page
		.getByTestId('swimlane-description-input')
		.fill('**Tests** before review');
	await page.getByTestId('swimlane-description-save').click();
	await expect(marker).toBeVisible();

	// Persisted, not just the optimistic copy.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(marker).toBeVisible();

	await openLanePanel(page, name);
	const body = page.getByTestId('swimlane-description-body');
	await expect(body.locator('strong')).toHaveText('Tests');

	// Opened on the current text.
	await page.getByTestId('swimlane-description-edit').click();
	await expect(page.getByTestId('swimlane-description-input')).toHaveValue(
		'**Tests** before review',
	);

	// Emptied, the marker goes with it.
	await page.getByTestId('swimlane-description-input').fill('');
	await page.getByTestId('swimlane-description-save').click();
	await expect(marker).toHaveCount(0);

	await deleteLane(page, name);
	expect(pageErrors).toEqual([]);
});

test('a half-written lane description keeps the panel open past a stray click', async ({
	page,
	pageErrors,
}) => {
	const name = `Unsaved ${Date.now()}`;
	await addLane(page, name);

	await openLanePanel(page, name);
	await page.getByTestId('swimlane-description-edit').click();
	await page.getByTestId('swimlane-description-input').fill('Half written');

	await page.getByRole('main').click({position: {x: 40, y: 40}});
	await expect(page.getByTestId('swimlane-description-input')).toHaveValue(
		'Half written',
	);

	// Escape drops the edit, as a ticket's does, and writes nothing.
	await page.getByTestId('swimlane-description-input').press('Escape');
	await expect(page.getByTestId('swimlane-description-input')).toHaveCount(0);
	await expect(
		lane(page, name).getByTestId('swimlane-stats-open-marker'),
	).toHaveCount(0);

	await deleteLane(page, name);
	expect(pageErrors).toEqual([]);
});

test("the board's description is written in its panel, opened beside the switcher", async ({
	page,
	pageErrors,
}) => {
	// A board of this test's own: describing Default would reach every other
	// test on the shared project.
	const name = `Describable ${Date.now()}`;

	await page.keyboard.press('Control+k');
	await page.keyboard.type('new board');
	await page.keyboard.press('Enter');
	await page.getByPlaceholder('board name').fill(name);
	await page.getByPlaceholder('board name').press('Enter');
	await expect(page.getByTestId('board-switcher')).toContainText(name);

	const marker = page.getByTestId('board-details-open-marker');
	await expect(marker).toHaveCount(0);

	await page.getByTestId('board-details-open').click();
	const panel = page.getByTestId('board-details');
	await expect(panel).toContainText('Board');
	await expect(panel).toContainText(name);

	await page.getByTestId('board-description-edit').click();
	await page.getByTestId('board-description-input').fill('Ship **weekly**');
	await page.getByTestId('board-description-save').click();
	await expect(marker).toBeVisible();

	// Persisted, and reached from the palette too.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
	await expect(marker).toBeVisible();

	await page.keyboard.press('Control+k');
	await page.keyboard.type('board details');
	await expect(
		page.getByTestId('command-palette').getByRole('option').first(),
	).toContainText('Board details');
	await page.keyboard.press('Enter');

	await expect(
		page.getByTestId('board-description-body').locator('strong'),
	).toHaveText('weekly');

	// The button toggles it shut, as a lane's does.
	await page.getByTestId('board-details-open').click();
	await expect(panel).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
