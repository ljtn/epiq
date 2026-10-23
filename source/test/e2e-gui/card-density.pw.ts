import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

// The board's two card densities: wide, as cards have always been, and dense,
// a title and one line under it. The switch is the viewer's own, kept across
// a reload; on either, a card's assignee and tags narrow the board.

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const aside = (page: Page) => page.locator('aside');

// The add row stays open after an add, so only the first tag opens it.
const tagOpenTicket = async (page: Page, tag: string) => {
	if (!(await page.getByPlaceholder('tag name').isVisible())) {
		await aside(page)
			.getByRole('button', {name: '+', exact: true})
			.first()
			.click();
	}
	await page.getByPlaceholder('tag name').fill(tag);
	await page.getByPlaceholder('tag name').press('Enter');
	await expect(aside(page)).toContainText(tag);
};

const assignSelf = async (page: Page) => {
	await aside(page).getByTestId('assignees-empty').click();
	await aside(page).getByRole('button', {name: '+ @me'}).click();
	await expect(aside(page).getByTestId('assignees-empty')).toHaveCount(0);
};

const goDense = async (page: Page) => {
	await page.getByTestId('card-density-dense').click();
	await expect(page.getByTestId('card-density-dense')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('dense cards are a switch away, and stay dense across a reload', async ({
	page,
	pageErrors,
}) => {
	const title = `Dense ${Date.now()}`;
	await addTicket(page, title);
	await page.goto(page.url().replace(/\/issue\/.*$/, ''));

	// Wide: the card's ref is the copyable one beside its figures, no dense line.
	await expect(card(page, title).getByTestId('ticket-ref')).toHaveCount(0);

	await goDense(page);
	await expect(card(page, title).getByTestId('ticket-ref')).toBeVisible();

	await page.reload();
	await expect(card(page, title).getByTestId('ticket-ref')).toBeVisible();
	await expect(page.getByTestId('card-density-dense')).toHaveAttribute(
		'aria-pressed',
		'true',
	);

	// Wide again from its own word.
	await page.getByTestId('card-density-wide').click();
	await expect(card(page, title).getByTestId('ticket-ref')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('a card names its assignee, and the name and the tags narrow the board in either density', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const mine = `Mine ${stamp}`;
	const other = `Other ${stamp}`;

	await addTicket(page, mine);
	await tagOpenTicket(page, `t${stamp}`);
	await assignSelf(page);
	await addTicket(page, other);
	const boardUrl = page.url().replace(/\/issue\/.*$/, '');
	await page.goto(boardUrl);

	for (const dense of [false, true]) {
		if (dense) await goDense(page);

		const name = card(page, mine).getByTestId('ticket-assignee');
		await expect(name).toBeVisible();
		await name.click();
		await expect(card(page, other)).toHaveCount(0);
		await expect(name).toHaveAttribute('aria-pressed', 'true');
		// The card was not selected by the click.
		await expect(page).not.toHaveURL(/\/issue\//);
		await name.click();
		await expect(card(page, other)).toBeVisible();

		const tag = card(page, mine).getByTestId('ticket-tag').first();
		await tag.click();
		await expect(card(page, other)).toHaveCount(0);
		await tag.click();
		await expect(card(page, other)).toBeVisible();
	}

	expect(pageErrors).toEqual([]);
});

test('a dense card shows four tags and an ellipsis for the rest, and is live when just touched', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const title = `Tagged ${stamp}`;

	await addTicket(page, title);
	for (const n of [1, 2, 3, 4, 5]) await tagOpenTicket(page, `t${n}-${stamp}`);
	await page.goto(page.url().replace(/\/issue\/.*$/, ''));
	await goDense(page);

	await expect(card(page, title).getByTestId('ticket-tag')).toHaveCount(4);
	await expect(card(page, title).getByTestId('ticket-tags-more')).toBeVisible();
	// Written to a moment ago, so it is being worked on.
	await expect(card(page, title).getByTestId('ticket-live')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
