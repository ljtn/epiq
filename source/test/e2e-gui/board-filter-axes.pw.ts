import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const tagOpenTicket = async (page: Page, tag: string) => {
	await page
		.locator('aside')
		.getByRole('button', {name: '+', exact: true})
		.first()
		.click();
	await page.getByPlaceholder('tag name').fill(tag);
	await page.getByPlaceholder('tag name').press('Enter');
	await expect(page.locator('aside')).toContainText(tag);
};

test('two axes narrow the board together', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const tagged = `Tagged ${stamp}`;
	const plain = `Plain ${stamp}`;
	const tag = `t${stamp}`;

	await addTicket(page, tagged);
	await tagOpenTicket(page, tag);
	await addTicket(page, plain);

	await page.goto(boardUrl);
	await card(page, tagged)
		.getByTestId('ticket-tag')
		.filter({hasText: tag})
		.click();
	await expect(card(page, plain)).toHaveCount(0);

	// A second axis switched on joins the first rather than replacing it: the
	// tagged ticket has been touched, so it passes both and stays.
	await page.getByRole('button', {name: /^Tags/}).click();
	await page.getByRole('checkbox', {name: 'Contributors'}).click();

	await expect(page).toHaveURL(/only=.*tag/);
	await expect(page).toHaveURL(/only=.*actor/);
	await expect(card(page, tagged)).toBeVisible();
	await expect(card(page, plain)).toHaveCount(0);

	// And unticking it hands back the one axis, not both.
	await page.getByRole('checkbox', {name: 'Contributors'}).click();
	await expect(page).not.toHaveURL(/actor/);
	await expect(page).toHaveURL(/only=tag/);
	await expect(card(page, tagged)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('opening a row list does not switch its axis on', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByRole('button', {name: 'Board events'}).click();

	// Reading what is under a row is not the same as filtering by it.
	await page.getByRole('button', {name: 'Pick which comments to show'}).click();
	// Exact: the list it opened has a `No comments` row of its own, and a
	// substring match takes both.
	await expect(
		page.getByRole('checkbox', {name: 'Comments', exact: true}),
	).toHaveAttribute('aria-checked', 'false');
	await expect(page).not.toHaveURL(/only=/);

	expect(pageErrors).toEqual([]);
});

test('a half-ticked list puts its row in the dash', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	// Two tags, so there is something for a half-ticked list to be half of.
	const stamp = Date.now();
	for (const suffix of ['a', 'b']) {
		await addTicket(page, `Dash ${suffix} ${stamp}`);
		await tagOpenTicket(page, `t${suffix}${stamp}`);
	}

	await page.goto(boardUrl);
	await page.getByRole('button', {name: 'Board events'}).click();

	const tags = page.getByRole('checkbox', {name: 'Tags'});
	await tags.click();
	await expect(tags).toHaveAttribute('aria-checked', 'true');

	await page.getByRole('button', {name: 'Pick which tags to show'}).click();
	const tagList = page.getByRole('group', {name: 'Which tags to show'});
	await tagList.getByRole('checkbox', {name: `ta${stamp}`}).click();

	// On, but not with everything under it.
	await expect(tags).toHaveAttribute('aria-checked', 'mixed');
	await expect(card(page, `Dash a ${stamp}`)).toHaveCount(0);
	await expect(card(page, `Dash b ${stamp}`)).toBeVisible();

	// The parent is the way back out of a half-ticked list: ticking it takes
	// the whole axis again, whatever the children were left saying.
	await tags.click();
	await expect(tags).toHaveAttribute('aria-checked', 'true');
	await expect(
		tagList.getByRole('checkbox', {name: `ta${stamp}`}),
	).toBeChecked();
	await expect(card(page, `Dash a ${stamp}`)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
