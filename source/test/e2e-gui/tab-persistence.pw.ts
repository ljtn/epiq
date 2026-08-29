import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');

	// Waits for this ticket's own details, not just any /issue/ url: creation
	// navigates to the new ticket, and a url left over from the previous one
	// would satisfy the looser check while that navigation is still in flight —
	// landing later and resetting the tab.
	await expect(page.locator('aside')).toContainText(title);
};

const openFromBoard = async (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title}).first().click();

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the open tab carries across ticket selections', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const first = `Tab A ${stamp}`;
	const second = `Tab B ${stamp}`;

	await addTicket(page, first);
	await addTicket(page, second);

	await page.getByRole('button', {name: /^Comments/}).click();
	await expect(page).toHaveURL(/tab=comments/);

	await openFromBoard(page, first);
	await expect(page).toHaveURL(/tab=comments/);
	await expect(page.getByPlaceholder(/comment/i)).toBeVisible();

	// Any tab, not just comments.
	await page.getByRole('button', {name: /^Log/}).click();
	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=history/);
	await expect(page.getByTestId('issue-history')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// Regression test: switching directly from one ticket to another while the
// Commits tab is already open used to leave the pane stuck on "Loading
// commits…" forever — the fetch for the new ticket was silently dropped
// because a same-render effect (recreating the websocket, keyed off an
// unstable `navigate` reference) nulled the socket ref between this effect's
// setup and its own send call. Re-clicking the tab was the only way to
// recover, since only *that* triggered a genuinely fresh effect run.
test('switching tickets with the Commits tab already open still loads the new ticket', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const first = `Commits refetch A ${stamp}`;
	const second = `Commits refetch B ${stamp}`;

	await addTicket(page, first);
	await addTicket(page, second);

	await openFromBoard(page, first);
	await page.getByRole('button', {name: /^Commits/}).click();
	await expect(page).toHaveURL(/tab=code/);
	// Neither ticket has any linked commits, so the tab settles on the empty
	// state — the interesting assertion is that it settles at all, not what
	// it settles on.
	await expect(page.getByText(/no commits reference this ticket/i)).toBeVisible();

	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=code/);
	await expect(page.getByText('Loading commits…')).toBeHidden();
	await expect(page.getByText(/no commits reference this ticket/i)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('the comment count on a card still opens comments', async ({page}) => {
	const title = `Count ${Date.now()}`;
	await addTicket(page, title);

	await page.getByRole('button', {name: /^Comments/}).click();
	await page.getByPlaceholder(/comment/i).fill('a remark');
	await page.getByRole('button', {name: 'comment', exact: true}).click();
	await expect(page.getByText('a remark')).toBeVisible();

	// Back to overview, then in through the card's comment count.
	await page.getByRole('button', {name: 'Overview'}).click();
	await expect(page).toHaveURL(/tab=overview/);

	await page
		.locator('[draggable="true"]')
		.filter({hasText: title})
		.getByTitle(/comment/i)
		.click();

	await expect(page).toHaveURL(/tab=comments/);
});
