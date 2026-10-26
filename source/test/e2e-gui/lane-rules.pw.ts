import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const pill = (page: Page, goal: string) =>
	page.getByTestId('goal-pill').filter({hasText: goal});

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('a lane marked done in its panel counts its tickets done for their goal', async ({
	page,
	pageErrors,
}) => {
	const goal = `Rules ${Date.now()}`;
	await addTicket(page, `Waiting ${goal}`);
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-create').click();
	await expect(pill(page, goal)).toContainText('0/1');

	// `add-issue` files into the first lane. The worker's board is shared, so
	// the lane and the goal strip are put back however this ends.
	const rule = page.getByTestId('swimlane-rule-done').locator('input');
	try {
		await page.getByTestId('swimlane-menu').first().click();
		await rule.check();
		await expect(pill(page, goal)).toContainText('1/1');
		await expect(page.getByTestId('swimlane-marks-done')).toHaveCount(1);

		await rule.uncheck();
		await expect(pill(page, goal)).toContainText('0/1');
		await expect(page.getByTestId('swimlane-marks-done')).toHaveCount(0);
	} finally {
		if ((await page.getByTestId('swimlane-marks-done').count()) > 0) {
			await rule.uncheck();
		}
		// Pressed again, the menu button closes the lane's panel.
		await page.getByTestId('swimlane-menu').first().click();
		await expect(page.getByTestId('swimlane-stats')).toHaveCount(0);
		await page.getByText(`Waiting ${goal}`).click();
		await page.getByTestId('goal-current').click();
		await page.getByTestId('goal-leave').click();
		await expect(pill(page, goal)).toHaveCount(0);
	}

	expect(pageErrors).toEqual([]);
});
