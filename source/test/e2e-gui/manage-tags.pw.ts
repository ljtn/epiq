import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Adding a tag closes the add row again, so each one starts by reopening it.
const addTag = async (page: Page, name: string) => {
	await page
		.locator('aside section')
		.filter({has: page.getByText('Tags', {exact: true})})
		.getByRole('button', {name: '+', exact: true})
		.click();
	await page.getByPlaceholder('tag name').fill(name);
	await page.getByPlaceholder('tag name').press('Enter');
	await expect(page.locator('aside')).toContainText(name);
};

// Arming a delete used to show up only on the confirm button, at the far end of
// a 460px row from the name it belongs to — so the modal never said which tag
// was about to go. The row itself carries the state now.
test('arming a delete highlights the whole tag row', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const first = `atag${stamp}`;
	const second = `btag${stamp}`;

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Tags ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Tags ${stamp}`);

	await addTag(page, first);
	await addTag(page, second);

	// Reopen the add row once more: that is where the manage entry point lives.
	await page
		.locator('aside section')
		.filter({has: page.getByText('Tags', {exact: true})})
		.getByRole('button', {name: '+', exact: true})
		.click();
	await page.getByRole('button', {name: 'manage tags…'}).click();

	const armed = page.locator(
		'[data-testid="manage-tag-row"][data-armed="true"]',
	);
	await expect(armed).toHaveCount(0);

	await page.getByTitle(`Delete "${first}"`).click();

	// Exactly one row is armed, it names the tag that was clicked, and it is
	// painted rather than left to the button at the other end of the row.
	await expect(armed).toHaveCount(1);
	await expect(armed).toContainText(first);
	await expect(armed).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	// Arming another row moves the highlight rather than lighting a second.
	await page.getByTitle(`Delete "${second}"`).click();
	await expect(armed).toHaveCount(1);
	await expect(armed).toContainText(second);

	expect(pageErrors).toEqual([]);
});
