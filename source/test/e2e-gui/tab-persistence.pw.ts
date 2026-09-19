import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTestId('add-issue').first().click();
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
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=code/);
	await expect(
		page.getByText(/no commits reference this ticket/i),
	).toBeVisible();

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
	await expect(
		page.getByText(/no commits reference this ticket/i),
	).toBeVisible();

	await openFromBoard(page, second);
	await expect(page).toHaveURL(/tab=code/);
	await expect(page.getByText('Loading commits…')).toBeHidden();
	await expect(
		page.getByText(/no commits reference this ticket/i),
	).toBeVisible();

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
	await page.getByRole('button', {name: 'comment', exact: true}).click();
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
				(node as unknown as {style: {background: string}}).style.background,
		),
	).toBe('transparent');

	// The index sits in the card's margin on the title's first line and takes
	// no room from the title, whatever its figure. Counted from one: the
	// lane's first card says so, since this card's own position is not known.
	const lane = card.locator('..');
	await expect(lane.getByTestId('ticket-index').first()).toHaveText('1');
	const index = card.getByTestId('ticket-index');
	await expect(index).toHaveText(/^\d+$/);
	// Both rectangles in one read: opening the ticket selected the card, which
	// scrolls itself into view, and two reads either side of that scroll put
	// the same card's index and title hundreds of pixels apart.
	type Rect = {x: number; y: number; width: number; height: number};
	const geometry = await card.evaluate(node => {
		const rect = (selector: string): Rect =>
			(
				node as unknown as {
					querySelector: (s: string) => {getBoundingClientRect: () => Rect};
				}
			)
				.querySelector(selector)
				.getBoundingClientRect();

		return {
			index: rect('[data-testid="ticket-index"]'),
			title: rect('[data-testid="ticket-title"]'),
		};
	});
	const boxes = JSON.stringify(geometry);
	expect(geometry.index.x + geometry.index.width, boxes).toBeLessThanOrEqual(
		geometry.title.x,
	);
	expect(Math.abs(geometry.index.y - geometry.title.y), boxes).toBeLessThan(2);

	await count.click();
	await expect(page).toHaveURL(/tab=comments/);
});
