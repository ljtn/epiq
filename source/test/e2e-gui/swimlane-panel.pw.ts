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

const lane = (page: Page, name: string) =>
	page.locator('section').filter({hasText: name});

// The lane's Overview, unless it is already the panel on screen: its menu
// button, pressed again, would close it.
const openOverview = async (page: Page, name: string) => {
	const title = page.getByTestId('swimlane-stats-title');
	if ((await title.count()) > 0 && (await title.textContent()) === name) return;
	await lane(page, name).getByTestId('swimlane-menu').click();
	await expect(title).toHaveText(name);
};

const rename = async (page: Page, from: string, to: string) => {
	await openOverview(page, from);
	await page.getByTestId('swimlane-stats-title').click();
	const field = page.getByTestId('swimlane-stats-title-input');
	// Prefilled with the current title rather than blank.
	await expect(field).toHaveValue(from);
	await field.fill(to);
	await field.press('Enter');
};

const remove = async (page: Page, name: string) => {
	await openOverview(page, name);
	await page.getByTestId('swimlane-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the menu opens a lane on its Overview, the chart on its Stats, and either again closes it', async ({
	page,
	pageErrors,
}) => {
	const name = `Tabs ${Date.now()}`;
	await addLane(page, name);

	await lane(page, name).getByTestId('swimlane-stats-open').click();
	await expect(page.getByText('Time in this lane')).toBeVisible();
	await expect(page.getByTestId('swimlane-rule-done')).toHaveCount(0);

	await lane(page, name).getByTestId('swimlane-menu').click();
	await expect(page.getByTestId('swimlane-rule-done')).toBeVisible();

	await lane(page, name).getByTestId('swimlane-menu').click();
	await expect(page.getByTestId('swimlane-stats')).toHaveCount(0);

	await remove(page, name);
	expect(pageErrors).toEqual([]);
});

test('renames a swimlane from its title in the panel', async ({
	page,
	pageErrors,
}) => {
	const before = `Rename me ${Date.now()}`;
	const after = `${before} renamed`;

	await addLane(page, before);
	await rename(page, before, after);

	await expect(lane(page, after)).toHaveCount(1);
	await expect(page.getByText(before, {exact: true})).toHaveCount(0);

	await remove(page, after);
	expect(pageErrors).toEqual([]);
});

test('deletes an empty swimlane after confirming', async ({
	page,
	pageErrors,
}) => {
	const name = `Delete me ${Date.now()}`;

	await addLane(page, name);

	await openOverview(page, name);
	await page.getByTestId('swimlane-delete').click();

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

	await lane(page, name).getByTestId('add-issue').click();
	await page.getByPlaceholder('ticket name').fill('Doomed ticket');
	await page.getByPlaceholder('ticket name').press('Enter');
	await expect(page.getByText('Doomed ticket').first()).toBeVisible();

	await openOverview(page, name);
	await page.getByTestId('swimlane-delete').click();

	const confirm = page.getByTestId('confirm-modal');
	await expect(confirm).toContainText('1 ticket');

	await confirm.getByRole('button', {name: 'cancel'}).click();

	await expect(lane(page, name)).toHaveCount(1);
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

	const renamed = `${name} renamed`;
	await rename(page, name, renamed);
	await expect(lane(page, renamed)).toHaveCount(1, {timeout: 2000});

	await page
		.getByTestId('swimlane-rule-done')
		.locator('input')
		.check({timeout: 2000});
	await expect(
		lane(page, renamed).getByTestId('swimlane-marks-done'),
	).toBeVisible();

	await page.getByTestId('swimlane-delete').click();
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

	await remove(page, name);
});

test('a readonly board opens its lanes read-only', async ({page}) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Closed'})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText('Closed');

	await page.getByTestId('swimlane-menu').first().click();
	await expect(page.getByTestId('swimlane-stats')).toBeVisible();
	await expect(page.getByTestId('swimlane-delete')).toHaveCount(0);
	await expect(
		page.getByTestId('swimlane-rule-done').locator('input'),
	).toBeDisabled();

	await page.getByTestId('swimlane-stats-title').click();
	await expect(page.getByTestId('swimlane-stats-title-input')).toHaveCount(0);
});
