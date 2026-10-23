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

// As the empty state does before there is a chip; a chip keeps its own click.
test('a row of chips opens its picker from the ground beside them', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openNewTicket(page, appUrl);
	const stamp = Date.now();
	const input = aside(page).getByPlaceholder('Tag name');
	const row = aside(page).getByTestId('tags-row');

	await aside(page).getByTestId('tags-empty').click();
	await input.fill(`kept-${stamp}`);
	await input.press('Enter');
	await input.fill(`dropped-${stamp}`);
	await input.press('Enter');
	await input.press('Escape');
	await expect(input).toBeHidden();

	const box = await row.boundingBox();
	await row.click({position: {x: box!.width - 4, y: box!.height / 2}});
	await expect(input).toBeFocused();
	await input.press('Escape');

	await row.getByRole('button', {name: `dropped-${stamp}`}).click();
	await expect(row).not.toContainText(`dropped-${stamp}`);
	await expect(row).toContainText(`kept-${stamp}`);
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
