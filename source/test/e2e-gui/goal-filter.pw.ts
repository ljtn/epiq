import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const putOpenTicketInGoal = async (page: Page, goal: string) => {
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-option').filter({hasText: goal}).click();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);
};

test("clicking a goal's pill narrows the board to the goal, and the URL carries it", async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const goal = `Bigger ${stamp}`;
	const member = `Member ${stamp}`;
	const other = `Other ${stamp}`;

	await addTicket(page, goal);
	await addTicket(page, other);
	await addTicket(page, member);
	await putOpenTicketInGoal(page, goal);

	await page.goto(boardUrl);
	await expect(card(page, other)).toBeVisible();

	// A card in a goal carries its colour down its edge; one in none does not.
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

	const pill = card(page, member).getByTestId('ticket-goal');
	await pill.click();

	// The goal and its ticket stay, the rest goes, and the click selects nothing.
	await expect(card(page, other)).toHaveCount(0);
	await expect(card(page, member)).toBeVisible();
	await expect(page.getByTestId('ticket-goal-own')).toHaveCount(1);
	await expect(pill).toHaveAttribute('aria-pressed', 'true');
	await expect(page).not.toHaveURL(/\/issue\//);
	await expect(page).toHaveURL(/goal=/);

	await page.goto(page.url());
	await expect(card(page, other)).toHaveCount(0);
	await expect(card(page, member)).toBeVisible();

	// The goal's own pill lets go as well as a member's does.
	await page.getByTestId('ticket-goal-own').click();
	await expect(card(page, other)).toBeVisible();
	await expect(page).not.toHaveURL(/goal=/);

	expect(pageErrors).toEqual([]);
});

test('clicking the goal a ticket is in opens the picker, which can take it out of the goal', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const goal = `Larger ${stamp}`;
	const member = `Part ${stamp}`;

	await addTicket(page, goal);
	await addTicket(page, member);
	await putOpenTicketInGoal(page, goal);

	// Not a tag: a click asks what to change it to, and takes nothing away.
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
	await expect(page.getByTestId('goal-search')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('a new goal is named in the picker, and removing it takes its tickets out', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const goal = `Fresh ${stamp}`;
	const member = `Joiner ${stamp}`;

	await addTicket(page, member);
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-create').click();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);

	// The goal is a ticket of its own, in the same lane.
	await expect(card(page, goal)).toHaveCount(2);

	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-manage').click();
	const row = page.getByTestId('manage-goal-row').filter({hasText: goal});
	await row.getByTestId('remove-goal').click();
	await row.getByTestId('remove-goal').click();
	await expect(
		page.getByTestId('manage-goal-row').filter({hasText: goal}),
	).toHaveCount(0);
	await page
		.getByTestId('manage-goals')
		.getByRole('button', {name: 'Close', exact: true})
		.click();

	await expect(page.getByTestId('goal-current')).toHaveText('No goal');

	expect(pageErrors).toEqual([]);
});

test('a goal removed while the board shows only it gives the board back', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const goal = `Passing ${stamp}`;
	const member = `Within ${stamp}`;
	const other = `Without ${stamp}`;

	await addTicket(page, other);
	await addTicket(page, member);
	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-search').fill(goal);
	await page.getByTestId('goal-create').click();
	await expect(page.getByTestId('goal-current')).toHaveText(goal);

	await card(page, member).getByTestId('ticket-goal').click();
	await expect(card(page, other)).toHaveCount(0);

	await page.getByTestId('goal-current').click();
	await page.getByTestId('goal-manage').click();
	const row = page.getByTestId('manage-goal-row').filter({hasText: goal});
	await row.getByTestId('remove-goal').click();
	await row.getByTestId('remove-goal').click();
	await page
		.getByTestId('manage-goals')
		.getByRole('button', {name: 'Close', exact: true})
		.click();

	await expect(card(page, other)).toBeVisible();
	await page.goto(page.url());
	await expect(card(page, other)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
