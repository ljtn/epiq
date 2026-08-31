import {expect, test} from './fixtures.js';

const openModal = async (page: import('@playwright/test').Page) => {
	await page.getByTitle('Add issue').first().click();
	await expect(page.getByPlaceholder('issue name')).toBeVisible();
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// `cancel` must not be a submit button: as the form's first button it would be
// the default one, and Enter would activate it instead of submitting.
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

// Navigation used to be keyed to the issue:created broadcast, which reaches
// every connected client — so anyone else creating a ticket (another tab, a
// teammate, an agent) yanked this client to it, and a late broadcast reset
// the tab on a ticket you had already moved on from.
test('another client creating a ticket does not navigate this one', async ({
	page,
	context,
	appUrl,
	pageErrors,
}) => {
	const creator = await context.newPage();
	await creator.goto(appUrl);
	await expect(creator.getByTestId('board-switcher')).toContainText('Default');

	const title = `Someone else's ticket ${Date.now()}`;
	await openModal(creator);
	await creator.getByPlaceholder('issue name').fill(title);
	await creator.getByPlaceholder('issue name').press('Enter');

	// The creator navigates to its new ticket.
	await expect(creator).toHaveURL(/\/issue\//);

	// The old broadcast-driven navigation landed within milliseconds of the
	// creator's own; a grace window after it must leave the bystander where
	// it was. (It sees the ticket itself only on the next sync cycle.)
	await page.waitForTimeout(1500);
	await expect(page).not.toHaveURL(/\/issue\//);

	await creator.close();
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
