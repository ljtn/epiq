import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {switchToBoard} from './board-switcher.js';
import {addTicket} from './ticket.js';

const narrowToContributors = async (page: Page) => {
	await page.getByTestId('series-select').click();
	await page.getByRole('checkbox', {name: 'Contributors'}).click();
	await page.keyboard.press('Escape');
};

test('the board switcher counts every ticket, whatever the filter hides', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const title = `Counted ${Date.now()}`;
	await addTicket(page, title);
	await addTicket(page, `Hidden ${Date.now()}`);
	await page.goto(boardUrl);

	const defaultOption = page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Default'});

	await page.getByTestId('board-switcher').click();
	await expect(defaultOption).toContainText(/\d+ tickets/);
	const unfiltered = await defaultOption.textContent();
	await page.keyboard.press('Escape');

	await page.getByPlaceholder('Ref or title').fill(title);
	await expect(
		page.locator('[draggable="true"]').filter({hasText: 'Hidden'}),
	).toHaveCount(0);
	await page.getByTestId('board-switcher').click();
	await expect(defaultOption).toHaveText(unfiltered!);

	expect(pageErrors).toEqual([]);
});

test('switching board clears the window and the text, and keeps the scope and the axes', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.goto(`${page.url().split('?')[0]}?scope=week&window=1`);
	await narrowToContributors(page);
	await page.getByPlaceholder('Ref or title').fill('nothing matches this');
	await expect(page).toHaveURL(/window=1/);
	await expect(page).toHaveURL(/only=.*actor/);

	await switchToBoard(page, 'QA');

	await expect(page).not.toHaveURL(/window=1/);
	await expect(page).toHaveURL(/only=.*actor/);
	await expect(page).toHaveURL(/scope=week/);
	await expect(page.getByPlaceholder('Ref or title')).toHaveValue('');

	expect(pageErrors).toEqual([]);
});

test('staying on a ticket with unsent text keeps the filter', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await addTicket(page, `Draft kept ${Date.now()}`);
	await page.getByRole('button', {name: /^Comments/}).click();
	await page.locator('aside').getByPlaceholder('write a comment').fill('wip');
	await narrowToContributors(page);
	await expect(page).toHaveURL(/only=.*actor/);

	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'QA'})
		.click();
	const confirm = page.getByTestId('confirm-modal');
	await confirm.getByRole('button', {name: 'cancel'}).click();

	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page).toHaveURL(/only=.*actor/);

	expect(pageErrors).toEqual([]);
});

test('a lane the filter empties says how many it hides, and clears it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Behind the filter ${Date.now()}`;
	await addTicket(page, title);
	const card = page.locator('[draggable="true"]').filter({hasText: title});
	await expect(card).toBeVisible();
	await expect(page.getByTestId('lane-hidden-by-filter')).toHaveCount(0);

	await page
		.getByPlaceholder('Ref or title')
		.fill(`no such ticket ${Date.now()}`);
	await expect(card).toHaveCount(0);
	const note = page.getByTestId('lane-hidden-by-filter').first();
	await expect(note).toContainText(/\d+ hidden by filter/);

	await note.getByTestId('lane-clear-filter').click();
	await expect(card).toBeVisible();
	await expect(page.getByPlaceholder('Ref or title')).toHaveValue('');
	await expect(page.getByTestId('lane-hidden-by-filter')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
