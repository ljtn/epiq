import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Creates its own lane so the destructive tests never touch the seeded board's
// columns, which the other suites assert on.
const addLane = async (page: Page, name: string) => {
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(page.getByText(name)).toBeVisible();
};

const laneMenu = (page: Page, name: string) =>
	page.locator('section').filter({hasText: name}).getByTestId('swimlane-menu');

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('renames a swimlane from the kebab menu', async ({page, pageErrors}) => {
	const before = `Rename me ${Date.now()}`;
	const after = `${before} renamed`;

	await addLane(page, before);

	await laneMenu(page, before).click();
	await page.getByTestId('swimlane-menu-rename').click();

	// Prefilled with the current title rather than blank.
	const field = page.getByPlaceholder('swimlane name');
	await expect(field).toHaveValue(before);

	await field.fill(after);
	await field.press('Enter');

	await expect(page.getByText(after)).toBeVisible();
	await expect(page.getByText(before, {exact: true})).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('deletes an empty swimlane after confirming', async ({
	page,
	pageErrors,
}) => {
	const name = `Delete me ${Date.now()}`;

	await addLane(page, name);

	await laneMenu(page, name).click();
	await page.getByTestId('swimlane-menu-delete').click();

	const confirm = page.getByTestId('confirm-modal');
	await expect(confirm).toContainText(name);
	// Empty, so the copy must not threaten tickets that are not there.
	await expect(confirm).toContainText('empty');

	await confirm.getByRole('button', {name: 'delete'}).click();

	await expect(page.getByText(name)).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});

test('warns that the tickets go too, and cancelling keeps everything', async ({
	page,
}) => {
	const name = `Has tickets ${Date.now()}`;

	await addLane(page, name);

	const lane = page.locator('section').filter({hasText: name});
	await lane.getByTitle('Add issue').click();
	await page.getByPlaceholder('issue name').fill('Doomed ticket');
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.getByText('Doomed ticket').first()).toBeVisible();

	await laneMenu(page, name).click();
	await page.getByTestId('swimlane-menu-delete').click();

	const confirm = page.getByTestId('confirm-modal');
	await expect(confirm).toContainText('1 ticket');

	await confirm.getByRole('button', {name: 'cancel'}).click();

	await expect(page.getByText(name)).toBeVisible();
	await expect(page.getByText('Doomed ticket').first()).toBeVisible();
});

// A post-mutation state costs a full event-log boot — hundreds of ms on a real
// repo — so the board has to move on its own rather than wait for it.
test('the board updates before the server answers', async ({page}) => {
	const name = `Optimistic ${Date.now()}`;

	await addLane(page, name);

	// Every reply from here on is dropped, so anything that changes on screen
	// changed without the server's help.
	await page.route('**/ws', route => route.abort());
	await page.evaluate(`
		window.__socketSend = WebSocket.prototype.send;
		WebSocket.prototype.send = function () {};
	`);

	await laneMenu(page, name).click();
	await page.getByTestId('swimlane-menu-rename').click();

	const renamed = `${name} renamed`;
	const field = page.getByPlaceholder('swimlane name');
	await field.fill(renamed);
	await field.press('Enter');

	await expect(page.getByText(renamed)).toBeVisible({timeout: 2000});

	await laneMenu(page, renamed).click();
	await page.getByTestId('swimlane-menu-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();

	await expect(page.getByText(renamed)).toHaveCount(0);

	// Undo the patch so the lane is really removed and the next test starts clean.
	await page.evaluate('WebSocket.prototype.send = window.__socketSend');
	await page.unroute('**/ws');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByText(name)).toBeVisible();

	await laneMenu(page, name).click();
	await page.getByTestId('swimlane-menu-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);
});

test('no kebab on a readonly board', async ({page}) => {
	await expect(page.getByTestId('swimlane-menu').first()).toBeVisible();

	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Closed'})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText('Closed');

	await expect(page.getByTestId('swimlane-menu')).toHaveCount(0);
});
