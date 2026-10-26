import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const pill = (page: Page, goal: string) =>
	page.getByTestId('goal-pill').filter({hasText: goal});

// Names a new goal from the open ticket's Goal dropdown, which puts the
// ticket in it.
const startGoal = async (page: Page, goal: string) => {
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-create').click();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);
};

const joinGoal = async (page: Page, goal: string) => {
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-option').filter({hasText: goal}).click();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);
};

const openBoard = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
};

test('a goal is a pill above the lanes that narrows the board to it, and the URL carries it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	const stamp = Date.now();
	const goal = `Bigger ${stamp}`;
	const member = `Member ${stamp}`;
	const other = `Other ${stamp}`;

	await addTicket(page, other);
	await addTicket(page, member);
	await startGoal(page, goal);

	await expect(pill(page, goal)).toContainText('0/1');

	await page.goto(boardUrl);
	await expect(card(page, other)).toBeVisible();
	await expect(
		card(page, member).getByTestId('ticket-goal-stripe'),
	).toHaveCount(1);
	await expect(card(page, other).getByTestId('ticket-goal-stripe')).toHaveCount(
		0,
	);

	// The label sits in room the card already has.
	const height = async (title: string) =>
		(await card(page, title).boundingBox())?.height;
	expect(await height(member)).toBe(await height(other));
	await page.getByTestId('card-density-dense').click();
	await expect(page.getByTestId('card-density-dense')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	expect(await height(member)).toBe(await height(other));
	await page.getByTestId('card-density-wide').click();

	await pill(page, goal).click();
	await expect(card(page, other)).toHaveCount(0);
	await expect(card(page, member)).toBeVisible();
	await expect(pill(page, goal)).toHaveAttribute('aria-pressed', 'true');
	await expect(page).toHaveURL(/goal=/);

	await page.goto(page.url());
	await expect(card(page, other)).toHaveCount(0);

	// Its panel names it, counts it and lists its tickets, each a way in.
	const details = page.getByTestId('goal-details');
	await expect(details).toContainText(goal);
	await expect(page.getByTestId('goal-details-done')).toContainText('0/1');

	// The ref copies and leaves the panel where it is.
	const memberRow = page.getByTestId('goal-member').filter({hasText: member});
	await memberRow.getByTestId('copy-ref').click();
	await expect(details).toBeVisible();
	await expect(page).not.toHaveURL(/\/issue\//);

	// Its Stats tab measures the code of all its tickets together.
	const aside = page.locator('aside');
	await aside.getByRole('button', {name: 'Stats', exact: true}).click();
	await expect(aside).toContainText(
		'No commit carries the ref of a ticket in this goal',
	);
	await aside.getByRole('button', {name: 'Overview', exact: true}).click();

	await memberRow.getByTestId('goal-member-open').click();
	await expect(page.getByTestId('goal-details')).toHaveCount(0);
	await expect(page.locator('aside')).toContainText(member);
	await expect(card(page, other)).toHaveCount(0);

	// The card's own label lets go as well as the pill does.
	await card(page, member).getByTestId('ticket-goal').click();
	await expect(card(page, other)).toBeVisible();
	await expect(page).not.toHaveURL(/goal=/);

	expect(pageErrors).toEqual([]);
});

test("a goal's panel counts a closed ticket on the board it was closed from, as its pill does", async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const stamp = Date.now();
	const goal = `Closing ${stamp}`;
	const open = `Open ${stamp}`;
	const closing = `Closed ${stamp}`;

	await addTicket(page, open);
	await startGoal(page, goal);
	await addTicket(page, closing);
	await joinGoal(page, goal);

	await page.keyboard.press('Control+k');
	await page.keyboard.type('close ticket');
	const row = page.getByTestId('command-palette').getByRole('option').first();
	await expect(row).toContainText('Close ticket');
	await page.keyboard.press('Enter');
	await expect(card(page, closing)).toHaveCount(0, {timeout: 30_000});

	await pill(page, goal).click();
	await expect(page.getByTestId('goal-details-done')).toContainText('1/2');
	await expect(page.getByTestId('goal-details-here')).toContainText('2');
	// One group, this board's, the open ticket first.
	await expect(page.getByTestId('goal-group')).toHaveCount(1);
	await expect(page.getByTestId('goal-member').first()).toContainText(open);
	await expect(page.getByTestId('goal-member')).toHaveCount(2);

	expect(pageErrors).toEqual([]);
});

test('the palette puts the open ticket in a goal by name, and takes it out', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const stamp = Date.now();
	const goal = `Typed ${stamp}`;
	await addTicket(page, `Keyed ${stamp}`);

	const palette = page.getByTestId('command-palette');
	const rows = palette.getByRole('option');

	await page.keyboard.press('Control+k');
	await expect(palette).toBeVisible();
	await page.keyboard.type('put in a goal');
	await expect(rows.first()).toContainText('Put in a goal');
	await page.keyboard.press('Enter');
	await page.keyboard.type(goal);
	await expect(rows.filter({hasText: goal})).toHaveCount(1);
	await page.keyboard.press('Enter');

	await expect(palette).toBeHidden();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);
	await expect(pill(page, goal)).toContainText('0/1');

	await page.keyboard.press('Control+k');
	await page.keyboard.type('take out of its goal');
	await expect(rows.first()).toContainText('Take out of its goal');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('goal-current')).toHaveText('No goal');

	expect(pageErrors).toEqual([]);
});

test('the Goal dropdown picks, leaves, and closes on a press outside it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const stamp = Date.now();
	const goal = `Larger ${stamp}`;

	await addTicket(page, `Starter ${stamp}`);
	await startGoal(page, goal);
	await addTicket(page, `Part ${stamp}`);
	await joinGoal(page, goal);
	await expect(pill(page, goal)).toContainText('0/2');

	// The box it opens to stands where the folded one stood.
	const folded = await page.getByTestId('goal-current').boundingBox();
	await page.getByTestId('goal-current').click();
	await expect(page.getByTestId('goal-search')).toBeFocused();
	expect(await page.getByTestId('goal-search').boundingBox()).toEqual(folded);

	// Typing lists matches only, so Enter picks one rather than leaving.
	await page.getByTestId('goal-search').fill(goal);
	await expect(page.getByTestId('goal-leave')).toHaveCount(0);
	await page.getByTestId('goal-search').fill('');

	// A press just above the list, still in the section, closes it.
	const search = await page.getByTestId('goal-search').boundingBox();
	await page.mouse.click(search!.x + 20, search!.y - 6);
	await expect(page.getByTestId('goal-search')).toHaveCount(0);

	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-leave').click();
	await expect(page.getByTestId('goal-current')).toHaveText('No goal');
	await expect(pill(page, goal)).toContainText('0/1');

	expect(pageErrors).toEqual([]);
});

test('Manage goals renames and removes, and a removed goal gives the board back', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const stamp = Date.now();
	const goal = `Passing ${stamp}`;
	const renamed = `Renamed ${stamp}`;
	const member = `Within ${stamp}`;
	const other = `Without ${stamp}`;

	await addTicket(page, other);
	await addTicket(page, member);
	await startGoal(page, goal);

	await pill(page, goal).click();
	await expect(card(page, other)).toHaveCount(0);

	await page.getByTestId('goal-strip-manage').click();
	const dialog = page.getByTestId('manage-goals');
	const row = dialog.getByTestId('manage-goal-row').filter({hasText: goal});
	await row.getByTestId('rename-goal').click();
	await dialog.getByTestId('rename-goal-input').fill(renamed);
	await dialog.getByTestId('rename-goal-input').press('Enter');
	await expect(pill(page, renamed)).toBeVisible();
	await expect(card(page, member).getByTestId('ticket-goal')).toHaveText(
		renamed,
	);

	const renamedRow = dialog
		.getByTestId('manage-goal-row')
		.filter({hasText: renamed});
	await renamedRow.getByTestId('remove-goal').click();
	await renamedRow.getByTestId('remove-goal').click();
	await expect(renamedRow).toHaveCount(0);
	await dialog.getByRole('button', {name: 'Close', exact: true}).click();

	await expect(pill(page, renamed)).toHaveCount(0);
	await expect(card(page, member).getByTestId('ticket-goal')).toHaveCount(0);
	await expect(card(page, other)).toBeVisible();
	await page.goto(page.url());
	await expect(card(page, other)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('Manage goals adds a goal the board can then be put in', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const stamp = Date.now();
	const first = `First ${stamp}`;
	const second = `Second ${stamp}`;

	await addTicket(page, `Seed ${stamp}`);
	await startGoal(page, first);

	await page.getByTestId('goal-strip-manage').click();
	await page.getByTestId('new-goal-name').fill(second);
	await page.getByTestId('add-goal').click();
	await expect(
		page.getByTestId('manage-goal-row').filter({hasText: second}),
	).toBeVisible();
	await expect(pill(page, second)).toHaveCount(0);
	await page
		.getByTestId('manage-goals')
		.getByRole('button', {name: 'Close', exact: true})
		.click();

	await joinGoal(page, second);
	await expect(pill(page, second)).toContainText('0/1');
	await expect(pill(page, first)).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
