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

test('clicking a tag on a card narrows the board to it, and the URL carries it', async ({
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
	await expect(card(page, tagged)).toBeVisible();
	await expect(card(page, plain)).toBeVisible();

	const chip = card(page, tagged).getByTestId('ticket-tag').filter({
		hasText: tag,
	});
	await chip.click();

	// Narrowed: the untagged ticket is gone, the tagged one stays, the card is
	// not selected by the click, and the address bar says what is shown.
	await expect(card(page, plain)).toHaveCount(0);
	await expect(card(page, tagged)).toBeVisible();
	await expect(chip).toHaveAttribute('aria-pressed', 'true');
	await expect(page).not.toHaveURL(/\/issue\//);
	await expect(page).toHaveURL(/view=tagging/);
	await expect(page).toHaveURL(/only=/);
	const narrowedUrl = page.url();

	// The link alone reproduces the view.
	await page.goto(narrowedUrl);
	await expect(card(page, tagged)).toBeVisible();
	await expect(card(page, plain)).toHaveCount(0);

	// And clicking the isolated tag again is the way back.
	await card(page, tagged)
		.getByTestId('ticket-tag')
		.filter({hasText: tag})
		.click();
	await expect(card(page, plain)).toBeVisible();
	await expect(page).not.toHaveURL(/only=/);

	expect(pageErrors).toEqual([]);
});

test('a bare board link picks up the last selection, and a link wins over it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	await page.goto(`${boardUrl}?scope=week`);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Bare again: the stored week comes back, and is written into the address
	// bar so copying it hands over what is on screen.
	await page.goto(boardUrl);
	await expect(page).toHaveURL(/scope=week/);

	await page.goto(`${boardUrl}?scope=day`);
	await expect(page).toHaveURL(/scope=day/);
	await expect(page).not.toHaveURL(/scope=week/);

	expect(pageErrors).toEqual([]);
});
