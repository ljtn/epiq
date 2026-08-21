import {expect, test} from './fixtures.js';

const openModal = async (page: import('@playwright/test').Page) => {
	await page.getByTitle('Add issue').first().click();
	await expect(page.getByPlaceholder('issue name')).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// The regression: `cancel` had no explicit type, so as the form's first button
// it was the default one. Enter clicked it, the modal unmounted, and the submit
// event that would have created the ticket never fired — the modal just closed.
test('creates the ticket when Enter is pressed in the title field', async ({
	page,
	pageErrors,
}) => {
	await openModal(page);

	await page.getByPlaceholder('issue name').fill('Enter submits');
	await page.getByPlaceholder('issue name').press('Enter');

	// Creating navigates to the new ticket's details.
	await expect(page).toHaveURL(/\/issue\//);
	await expect(page.getByText('Enter submits').first()).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('cancel still closes without creating anything', async ({page}) => {
	await openModal(page);

	await page.getByPlaceholder('issue name').fill('Never created');
	await page.getByRole('button', {name: 'cancel'}).click();

	await expect(page.getByPlaceholder('issue name')).toHaveCount(0);
	await expect(page.getByText('Never created')).toHaveCount(0);
});

test('Escape closes without creating anything', async ({page}) => {
	await openModal(page);

	await page.getByPlaceholder('issue name').fill('Escaped');
	await page.getByPlaceholder('issue name').press('Escape');

	await expect(page.getByPlaceholder('issue name')).toHaveCount(0);
	await expect(page.getByText('Escaped')).toHaveCount(0);
});
