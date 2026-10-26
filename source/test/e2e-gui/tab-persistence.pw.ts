import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

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
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=code/);
	await expect(page.getByText(/no linked commits/i)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// Regression test: switching directly from one ticket to another while the
// Code tab is already open used to leave the pane stuck on "Loading
// commits…" forever — the fetch for the new ticket was silently dropped
// because a same-render effect (recreating the websocket, keyed off an
// unstable `navigate` reference) nulled the socket ref between this effect's
// setup and its own send call. Re-clicking the tab was the only way to
// recover, since only *that* triggered a genuinely fresh effect run.
test('switching tickets with the Code tab already open still loads the new ticket', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const first = `Commits refetch A ${stamp}`;
	const second = `Commits refetch B ${stamp}`;

	await addTicket(page, first);
	await addTicket(page, second);

	await openFromBoard(page, first);
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await expect(page).toHaveURL(/tab=code/);
	// Neither ticket has any linked commits, so the tab settles on the empty
	// state — the interesting assertion is that it settles at all, not what
	// it settles on.
	await expect(page.getByText(/no linked commits/i)).toBeVisible();

	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=code/);
	await expect(page.getByText('Loading commits…')).toBeHidden();
	await expect(page.getByText(/no linked commits/i)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('the Code tab shows its count before being opened, after Comments', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Commit count ${Date.now()}`);
	await expect(page).toHaveURL(/tab=overview/);

	const tabs = page
		.locator('aside')
		.getByRole('button', {name: /^(Overview|Comments|Code)\b/});
	await expect(tabs).toHaveText([
		/^Overview$/,
		/^Comments \(0\)$/,
		/^Code \(0\)$/,
	]);

	expect(pageErrors).toEqual([]);
});

test('the comment count on a card still opens comments', async ({page}) => {
	const title = `Count ${Date.now()}`;
	await addTicket(page, title);

	await page.getByRole('button', {name: /^Comments/}).click();
	await page.getByPlaceholder(/comment/i).fill('a remark');
	await page.getByRole('button', {name: 'Comment', exact: true}).click();
	await expect(page.getByText('a remark')).toBeVisible();

	// Back to overview, then in through the card's comment count.
	await page.getByRole('button', {name: 'Overview'}).click();
	await expect(page).toHaveURL(/tab=overview/);

	const card = page.locator('[draggable="true"]').filter({hasText: title});
	const count = card.getByTestId('ticket-comments');
	await expect(count).toHaveText('1');

	// Quiet chrome, like every other icon button: no ground until hovered.
	expect(
		await count.evaluate(
			node =>
				(node as unknown as {style: {backgroundColor: string}}).style
					.backgroundColor,
		),
	).toBe('transparent');

	await count.click();
	await expect(page).toHaveURL(/tab=comments/);
});
