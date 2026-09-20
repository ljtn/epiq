import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

const openTicket = async (page: import('@playwright/test').Page) => {
	await addTicket(page, `Stay open ${Date.now()}`);
};

test('clicking outside the details leaves it open', async ({
	page,
	pageErrors,
}) => {
	await openTicket(page);

	// A scrubber control and a swimlane header: clicks that were never about the
	// panel. Settled before asserting, or the check can land before a close has
	// had time to navigate and pass on nothing.
	await page.getByRole('button', {name: 'Events', exact: true}).click();
	await page.waitForTimeout(600);
	await expect(page).toHaveURL(/\/issue\//);

	await page.getByText('Todo').first().click();
	await page.waitForTimeout(600);
	await expect(page).toHaveURL(/\/issue\//);

	expect(pageErrors).toEqual([]);
});

test('an in-progress description survives a click outside', async ({page}) => {
	await openTicket(page);

	await page.getByRole('button', {name: 'edit'}).first().click();
	const draft = 'half-written thought';
	await page.getByRole('textbox').last().fill(draft);

	await page.getByRole('button', {name: 'Events', exact: true}).click();
	await page.waitForTimeout(600);

	await expect(page.getByRole('textbox').last()).toHaveValue(draft);
});

test('the × button still closes it', async ({page}) => {
	await openTicket(page);

	await page.getByRole('button', {name: 'Close', exact: true}).click();
	await expect(page).not.toHaveURL(/\/issue\//);
});
