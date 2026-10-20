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

const describeLane = async (page: Page, name: string) => {
	await lane(page, name).getByTestId('swimlane-menu').click();
	await page.getByTestId('swimlane-menu-describe').click();
	await expect(page.getByTestId('description-modal')).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('a lane is described from its menu, and reads as markdown beside its title', async ({
	page,
	pageErrors,
}) => {
	const name = `Described ${Date.now()}`;
	await addLane(page, name);

	// Nothing to read yet, so nothing beside the title.
	await expect(
		lane(page, name).getByTestId('swimlane-description'),
	).toHaveCount(0);

	await describeLane(page, name);
	await page
		.getByTestId('description-modal-input')
		.fill('**Tests** before review');
	await page.getByTestId('description-modal-save').click();
	await expect(page.getByTestId('description-modal')).toHaveCount(0);

	// Persisted, not just the optimistic copy.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await lane(page, name).getByTestId('swimlane-description').click();
	const body = page.getByTestId('swimlane-description-body');
	await expect(body.locator('strong')).toHaveText('Tests');

	// Edit from the popover opens on the current text.
	await page.getByTestId('swimlane-description-edit').click();
	await expect(page.getByTestId('description-modal-input')).toHaveValue(
		'**Tests** before review',
	);

	// Emptied, the marker goes with it.
	await page.getByTestId('description-modal-input').fill('');
	await page.getByTestId('description-modal-save').click();
	await expect(
		lane(page, name).getByTestId('swimlane-description'),
	).toHaveCount(0);

	await deleteLane(page, name);
	expect(pageErrors).toEqual([]);
});

test('cancelling a changed description asks before discarding it', async ({
	page,
	pageErrors,
}) => {
	const name = `Discard ${Date.now()}`;
	await addLane(page, name);

	await describeLane(page, name);
	await page.getByTestId('description-modal-input').fill('Half written');
	await page.keyboard.press('Escape');

	const confirm = page.getByTestId('confirm-modal');
	await expect(confirm).toContainText('Discard');

	// Kept: back in the editor with the text still there.
	await confirm.getByRole('button', {name: 'cancel'}).click();
	await expect(page.getByTestId('description-modal-input')).toHaveValue(
		'Half written',
	);

	await page.keyboard.press('Escape');
	await confirm.getByRole('button', {name: 'discard'}).click();
	await expect(page.getByTestId('description-modal')).toHaveCount(0);
	await expect(
		lane(page, name).getByTestId('swimlane-description'),
	).toHaveCount(0);

	await deleteLane(page, name);
	expect(pageErrors).toEqual([]);
});

test('the board on screen is described from the palette', async ({
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

	await expect(page.getByTestId('board-description')).toHaveCount(0);

	await page.keyboard.press('Control+k');
	await page.keyboard.type('board description');
	await expect(
		page.getByTestId('command-palette').getByRole('option').first(),
	).toContainText('Edit board description');
	await page.keyboard.press('Enter');

	await page.getByTestId('description-modal-input').fill('Ship weekly');
	await page.getByTestId('description-modal-save').click();

	await page.getByTestId('board-description').click();
	await expect(page.getByTestId('board-description-body')).toContainText(
		'Ship weekly',
	);

	expect(pageErrors).toEqual([]);
});
