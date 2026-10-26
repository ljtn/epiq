import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const pill = (page: Page, goal: string) =>
	page.getByTestId('goal-pill').filter({hasText: goal});

// The first lane's rule, which `add-issue` files into.
const switchDone = async (page: Page) => {
	await page.getByTestId('swimlane-menu').first().click();
	await page.getByTestId('swimlane-menu-rule-done').click();
};

test('a lane marked done counts its tickets done for their goal, and stops when unmarked', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const goal = `Rules ${Date.now()}`;
	await addTicket(page, `Waiting ${goal}`);
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-create').click();
	await expect(pill(page, goal)).toContainText('0/1');

	// The worker's board is shared, so the lane and the goal strip are put back
	// however this ends.
	try {
		await switchDone(page);
		await expect(pill(page, goal)).toContainText('1/1');
		await expect(page.getByTestId('swimlane-marks-done')).toHaveCount(1);

		await page.getByTestId('swimlane-menu').first().click();
		await expect(page.getByTestId('swimlane-menu-rule-done')).toHaveAttribute(
			'aria-checked',
			'true',
		);
		await page.getByTestId('swimlane-menu-rule-done').click();
		await expect(pill(page, goal)).toContainText('0/1');
		await expect(page.getByTestId('swimlane-marks-done')).toHaveCount(0);
	} finally {
		if ((await page.getByTestId('swimlane-marks-done').count()) > 0) {
			await switchDone(page);
		}
		await page.getByTestId('goal-current').click();
		await page.getByTestId('goal-leave').click();
		await expect(pill(page, goal)).toHaveCount(0);
	}

	expect(pageErrors).toEqual([]);
});
