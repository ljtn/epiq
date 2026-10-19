import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

// GH #475: what is typed into a ticket and not yet sent stays while the
// reader moves around that ticket, and is only dropped on leaving it, after
// asking.

const composer = (page: Page) =>
	page.locator('aside').getByPlaceholder('write a comment');

const openComments = (page: Page) =>
	page.getByRole('button', {name: /^Comments/}).click();

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('an unsent comment survives a trip to another tab', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Unsent comment ${Date.now()}`);
	await openComments(page);
	await composer(page).fill('half a thought');

	await page.getByRole('button', {name: 'Overview'}).click();
	await openComments(page);

	await expect(composer(page)).toHaveValue('half a thought');
	expect(pageErrors).toEqual([]);
});

test('a comment being edited survives a trip to another tab', async ({
	page,
}) => {
	await addTicket(page, `Edited comment ${Date.now()}`);
	await openComments(page);
	await composer(page).fill('as posted');
	await page.getByRole('button', {name: 'comment', exact: true}).click();
	await expect(page.locator('aside').getByText('as posted')).toBeVisible();

	await page.getByTestId('edit-comment').click();
	const editor = page.locator('aside textarea').first();
	await editor.fill('as rewritten');

	await page.getByRole('button', {name: 'Overview'}).click();
	await openComments(page);

	await expect(page.locator('aside textarea').first()).toHaveValue(
		'as rewritten',
	);
});

test('leaving the ticket with unsent text asks first', async ({
	page,
	pageErrors,
}) => {
	const stamp = Date.now();
	const first = `Has a draft ${stamp}`;
	const second = `Somewhere else ${stamp}`;
	await addTicket(page, second);
	await addTicket(page, first);
	await openComments(page);
	await composer(page).fill('not sent yet');

	// Staying: still on the ticket, text intact.
	await page.getByRole('main').getByText(second).click();
	const confirm = page.getByTestId('confirm-modal');
	await expect(confirm).toBeVisible();
	await confirm.getByRole('button', {name: 'cancel'}).click();
	await expect(confirm).toHaveCount(0);
	await expect(page.locator('aside')).toContainText(first);
	await expect(composer(page)).toHaveValue('not sent yet');

	// Closing asks too; discarding goes, and the text is gone for good.
	await page.getByRole('button', {name: 'Close', exact: true}).click();
	await expect(confirm).toBeVisible();
	await confirm.getByRole('button', {name: 'discard'}).click();
	await expect(page).not.toHaveURL(/\/issue\//);

	await page.getByRole('main').getByText(first).click();
	await openComments(page);
	await expect(composer(page)).toHaveValue('');

	// Nothing unsent, nothing to ask.
	await page.getByRole('main').getByText(second).click();
	await expect(page.locator('aside')).toContainText(second);
	await expect(confirm).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('the comment box grows with what is written in it', async ({page}) => {
	await addTicket(page, `Long comment ${Date.now()}`);
	await openComments(page);

	const before = (await composer(page).boundingBox())!.height;
	await composer(page).fill(
		Array.from({length: 10}, (_, i) => `line ${i}`).join('\n'),
	);

	await expect
		.poll(async () => (await composer(page).boundingBox())!.height)
		.toBeGreaterThan(before * 2);
});

test('an untouched description edit takes up somebody else’s change and never reverts it', async ({
	page,
	context,
	pageErrors,
}) => {
	await addTicket(page, `Edited elsewhere ${Date.now()}`);
	await page.getByRole('button', {name: 'edit'}).first().click();
	const box = page.getByRole('textbox').last();
	await expect(box).toHaveValue('');

	const other = await context.newPage();
	await other.goto(page.url());
	await other.getByRole('button', {name: 'edit'}).first().click();
	await other.getByRole('textbox').last().fill('written elsewhere');
	await other.getByRole('textbox').last().press('Enter');
	await expect(other.getByRole('button', {name: 'edit'}).first()).toBeVisible();

	await expect(box).toHaveValue('written elsewhere');
	await box.press('Enter');

	await page.reload();
	await expect(page.locator('aside')).toContainText('written elsewhere');
	expect(pageErrors).toEqual([]);
});
