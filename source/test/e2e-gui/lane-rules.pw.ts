import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const pill = (page: Page, goal: string) =>
	page.getByTestId('goal-pill').filter({hasText: goal});

const lane = (page: Page, name: string) =>
	page.locator('section').filter({hasText: name});

// The seeded board's lane called Done, by its header.
const doneHeader = (page: Page) =>
	page.getByTestId('swimlane-handle').filter({hasText: /^\W*Done\b/});

test('a lane marked done in its panel counts its tickets done, beside the lane named Done', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Its own lane, deleted at the end with its ticket: the worker's board is
	// shared.
	const name = `Released ${Date.now()}`;
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(lane(page, name)).toHaveCount(1);

	await lane(page, name).getByTestId('add-issue').click();
	await page.getByPlaceholder('ticket name').fill(`Waiting ${name}`);
	await page.getByPlaceholder('ticket name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Waiting ${name}`);
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(name);
	await page.getByTestId('goal-create').click();
	await expect(pill(page, name)).toContainText('0/1');

	// The board's lane called Done counts by its name, and says so throughout.
	const doneMark = doneHeader(page).getByTestId('swimlane-marks-done');
	await expect(doneMark).toHaveCount(1);

	await lane(page, name).getByTestId('swimlane-details-open').click();
	const rule = page.getByTestId('swimlane-rule-done').locator('input');
	try {
		await rule.check();
		await expect(pill(page, name)).toContainText('1/1');
		await expect(
			lane(page, name).getByTestId('swimlane-marks-done'),
		).toBeVisible();
		await expect(doneMark).toHaveCount(1);

		await rule.uncheck();
		await expect(pill(page, name)).toContainText('0/1');
		await expect(doneMark).toHaveCount(1);
	} finally {
		await page.getByTestId('swimlane-delete').click();
		await page
			.getByTestId('confirm-modal')
			.getByRole('button', {name: 'delete'})
			.click();
		await expect(lane(page, name)).toHaveCount(0);
		await expect(pill(page, name)).toHaveCount(0);
	}

	expect(pageErrors).toEqual([]);
});

test('the lane named Done is marked done, and cannot be unmarked', async ({
	page,
	appUrl,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await doneHeader(page).getByTestId('swimlane-details-open').click();
	const rule = page.getByTestId('swimlane-rule-done').locator('input');
	await expect(rule).toBeChecked();
	await expect(rule).toBeDisabled();
});
