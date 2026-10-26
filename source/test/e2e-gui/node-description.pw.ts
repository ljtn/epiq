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

const openLanePanel = async (page: Page, name: string) => {
	await lane(page, name).getByTestId('swimlane-details-open').click();
	await expect(page.getByTestId('swimlane-details')).toContainText(name);
};

// From the lane's Overview, which `openLanePanel` may have left open: its menu
// button would close it again.
const deleteLane = async (page: Page, name: string) => {
	if (!(await page.getByTestId('swimlane-delete').isVisible())) {
		await openLanePanel(page, name);
	}
	await page.getByTestId('swimlane-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);
};

// A board's row in the open switcher, by name.
const boardRow = (page: Page, name: string) =>
	page.getByTestId('board-switcher-row').filter({hasText: name});

const openBoardDetails = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await boardRow(page, name).getByTestId('board-details-open').click();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test("a lane's description is written in its panel", async ({
	page,
	pageErrors,
}) => {
	const name = `Described ${Date.now()}`;
	await addLane(page, name);
	await openLanePanel(page, name);
	await expect(page.getByTestId('swimlane-details')).toContainText('Swimlane');
	await expect(page.getByText('No description', {exact: true})).toBeVisible();
	await page.getByTestId('swimlane-description-edit').click();
	await page
		.getByTestId('swimlane-description-input')
		.fill('**Tests** before review');
	await page.getByTestId('swimlane-description-save').click();

	// Persisted, not just the optimistic copy.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await openLanePanel(page, name);
	const body = page.getByTestId('swimlane-description-body');
	await expect(body.locator('strong')).toHaveText('Tests');

	// Opened on the current text.
	await page.getByTestId('swimlane-description-edit').click();
	await expect(page.getByTestId('swimlane-description-input')).toHaveValue(
		'**Tests** before review',
	);

	// Emptied, it reads as none.
	await page.getByTestId('swimlane-description-input').fill('');
	await page.getByTestId('swimlane-description-save').click();
	await expect(page.getByText('No description', {exact: true})).toBeVisible();

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
	await expect(page.getByText('No description', {exact: true})).toBeVisible();

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

	await openBoardDetails(page, name);
	const panel = page.getByTestId('board-details');
	await expect(panel).toContainText('Board');
	await expect(panel).toContainText(name);

	await page.keyboard.press('Escape');
	await page.getByTestId('board-description-edit').click();
	await page.getByTestId('board-description-input').fill('Ship **weekly**');
	await page.getByTestId('board-description-save').click();

	// Persisted, and reached from the palette too.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText(name);

	await page.keyboard.press('Control+k');
	await page.keyboard.type('board details');
	await expect(
		page.getByTestId('command-palette').getByRole('option').first(),
	).toContainText('Board details');
	await page.keyboard.press('Enter');

	await expect(
		page.getByTestId('board-description-body').locator('strong'),
	).toHaveText('weekly');

	// The icon toggles it shut, as a lane's does.
	await openBoardDetails(page, name);
	await expect(panel).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("the switcher stays open while one board's details give way to another's", async ({
	page,
	pageErrors,
}) => {
	const name = `Compared ${Date.now()}`;

	await page.keyboard.press('Control+k');
	await page.keyboard.type('new board');
	await page.keyboard.press('Enter');
	await page.getByPlaceholder('board name').fill(name);
	await page.getByPlaceholder('board name').press('Enter');
	await expect(page.getByTestId('board-switcher')).toContainText(name);

	await openBoardDetails(page, 'Default');
	const panel = page.getByTestId('board-details');
	await expect(panel).toContainText('Default');

	// Still open: the next board's icon is a click away, and lit only for the
	// board on show.
	const theirs = boardRow(page, name).getByTestId('board-details-open');
	await theirs.click();
	await expect(panel).toContainText(name);
	await expect(theirs).toHaveAttribute('aria-pressed', 'true');
	await expect(
		boardRow(page, 'Default').getByTestId('board-details-open'),
	).toHaveAttribute('aria-pressed', 'false');

	await page.keyboard.press('Escape');
	expect(pageErrors).toEqual([]);
});
