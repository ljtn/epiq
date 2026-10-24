import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const putOpenTicketInGoal = async (page: Page, goal: string) => {
	const section = page
		.locator('aside section')
		.filter({has: page.getByTestId('goal-empty')});
	await section.getByRole('button', {name: '+', exact: true}).click();
	await page.getByTestId('goal-search').fill(goal);
	await page
		.locator('aside')
		.getByRole('button', {name: new RegExp(goal)})
		.click();
	await expect(
		page.locator('aside section').filter({hasText: /^Goal/}),
	).toContainText(`${goal} ×`);
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
