// A parked needle rides in the URL: a link or a reload opens the board at the
// same moment, a live board leaves it off and keeps following now, and history
// gains one entry where the needle is let go of, not one per step of a drag.

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {returnToLive} from './live-board.js';
import {trackWithWindow} from './track.js';
import {addTicket} from './ticket.js';

const atOf = (page: Page): string | null =>
	new URL(page.url()).searchParams.get('at');

const historyLength = (page: Page) =>
	page.evaluate(
		() => (globalThis as unknown as {history: {length: number}}).history.length,
	);

const readOnly = (page: Page) => page.getByText('Read-only', {exact: true});

const openBoard = async (page: Page, url: string) => {
	await page.goto(url);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
};

test.afterEach(async ({page}) => {
	await returnToLive(page);
});

test('a dragged needle adds one history entry where it is let go of, and Back and Forward move the board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const track = await trackWithWindow(page);
	const box = (await track.boundingBox())!;
	const grip = (await page.getByTestId('scrubber-needle-grip').boundingBox())!;
	const before = await historyLength(page);

	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, {
		steps: 30,
	});
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, {
		steps: 30,
	});
	await page.mouse.up();

	await expect(readOnly(page)).toBeVisible();
	await expect.poll(() => atOf(page)).not.toBeNull();
	const at = atOf(page);
	expect(await historyLength(page)).toBe(before + 1);

	await page.goBack();
	await expect.poll(() => atOf(page)).toBeNull();
	await expect(readOnly(page)).toHaveCount(0);

	await page.goForward();
	await expect.poll(() => atOf(page)).toBe(at);
	await expect(readOnly(page)).toBeVisible();

	// Back to live by the board's own control: the moment leaves the URL.
	await page.getByRole('button', {name: 'Now', exact: true}).click();
	await expect(readOnly(page)).toHaveCount(0);
	await expect.poll(() => atOf(page)).toBeNull();

	expect(pageErrors).toEqual([]);
});

test('a link with a moment opens the board there, and a live board reloads live', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url().split('?')[0]!;
	const moment = Date.now() - 1_000;

	await openBoard(page, `${boardUrl}?at=${moment}`);
	await expect(readOnly(page)).toBeVisible();
	expect(atOf(page)).toBe(String(moment));

	await page.getByRole('button', {name: 'Now', exact: true}).click();
	await expect.poll(() => atOf(page)).toBeNull();

	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.waitForTimeout(1_000);
	await expect(readOnly(page)).toHaveCount(0);
	expect(atOf(page)).toBeNull();

	expect(pageErrors).toEqual([]);
});

test('narrowing to the window takes a parked board live, and the moment out of the URL', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url().split('?')[0]!;

	await openBoard(page, `${boardUrl}?scope=day&at=${Date.now() - 1_000}`);
	await expect(readOnly(page)).toBeVisible();

	await page.getByTestId('spotlight').click();
	await expect(readOnly(page)).toHaveCount(0);
	await expect.poll(() => atOf(page)).toBeNull();

	expect(pageErrors).toEqual([]);
});

// The board's own routes are built afresh and leave the moment out; following
// one is no ask for live. Only Back and Forward move the needle.
test('opening a ticket keeps a parked board where it is', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url().split('?')[0]!;
	const title = `Parked open ${Date.now()}`;
	await addTicket(page, title);
	await openBoard(page, boardUrl);

	const moment = Date.now() + 500;
	await page.waitForTimeout(1_000);
	await openBoard(page, `${boardUrl}?at=${moment}`);
	await expect(readOnly(page)).toBeVisible();

	// By its title alone: a parked board is read-only, and its cards do not drag.
	await page.getByTestId('ticket-title').filter({hasText: title}).click();
	await expect(page.locator('aside')).toContainText(title);
	await page.waitForTimeout(1_000);

	await expect(readOnly(page)).toBeVisible();
	expect(atOf(page)).toBe(String(moment));

	expect(pageErrors).toEqual([]);
});
