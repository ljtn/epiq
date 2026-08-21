import {expect, test} from './fixtures.js';

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('creates a swimlane from the ghost column at the end of the board', async ({
	page,
	pageErrors,
}) => {
	const name = `Lane ${Date.now()}`;

	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');

	// Appended, so it is the last column and the ghost stays to its right.
	const columns = page.locator('section').filter({hasText: /\(\d+\)/});
	await expect(columns.last()).toContainText(name);
	await expect(page.getByTestId('add-swimlane')).toBeVisible();

	// Cleaned up: the suite shares one board, and a lane left behind changes what
	// every later file sees.
	await page
		.locator('section')
		.filter({hasText: name})
		.getByTestId('swimlane-menu')
		.click();
	await page.getByTestId('swimlane-menu-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The same `board.readonly` flag is forced true for every board while the
// timeline is scrubbed, so this covers that case too.
test('the ghost column is hidden on a readonly board', async ({page}) => {
	await expect(page.getByTestId('add-swimlane')).toBeVisible();

	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Closed'})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText('Closed');

	await expect(page.getByTestId('add-swimlane')).toHaveCount(0);
});
