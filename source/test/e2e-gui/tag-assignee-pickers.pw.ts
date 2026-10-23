import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const aside = (page: Page) => page.locator('aside');

const openNewTicket = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await addTicket(page, `Pickers ${Date.now()}`);
};

test('the tag row stays open for one tag after another', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl);
	const stamp = Date.now();
	const input = aside(page).getByPlaceholder('Tag name');

	await aside(page).getByTestId('tags-empty').click();
	await input.fill(`first-${stamp}`);
	await input.press('Enter');
	await expect(aside(page)).toContainText(`first-${stamp} ×`);

	await expect(input).toBeFocused();
	await expect(input).toHaveValue('');
	await input.fill(`second-${stamp}`);
	await input.press('Enter');
	await expect(aside(page)).toContainText(`second-${stamp} ×`);
	await expect(input).toBeFocused();

	await input.press('Escape');
	await expect(input).toBeHidden();

	expect(pageErrors).toEqual([]);
});

test('the assignee row stays open for one name after another', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl);
	const stamp = Date.now();
	const input = aside(page).getByPlaceholder('Name of unknown contributor');

	await aside(page).getByTestId('assignees-empty').click();
	await input.fill(`ann-${stamp}`);
	await input.press('Enter');
	await expect(aside(page)).toContainText(`@ann-${stamp} ×`);

	await expect(input).toBeFocused();
	await input.fill(`bo-${stamp}`);
	await input.press('Enter');
	await expect(aside(page)).toContainText(`@bo-${stamp} ×`);
	await expect(input).toBeFocused();

	expect(pageErrors).toEqual([]);
});
