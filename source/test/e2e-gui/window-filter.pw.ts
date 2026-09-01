import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const HOUR_MS = 60 * 60 * 1000;

// Long enough that an assertion made at a third of it cannot be satisfied by
// the reply instead of by the page.
const REPLY_DELAY_MS = 2400;

// A dragged-out window, which is the only kind with fixed bounds — every other
// is anchored to now, and a stretch that is over is what makes the filter say
// something.
const zoomed = (boardUrl: string, from: number, to: number) =>
	`${boardUrl}?window=1&from=${from}&to=${to}`;

// Counts the window replies the page has been handed, and can hold them back.
// The timeline is what the filter reads, so a test about a stale one has to
// know when the fresh one lands — otherwise a reply still in flight arrives
// after the change under test and the assertion passes on the wrong data.
const watchTimeline = async (page: Page, delayMs = 0) => {
	const seen = {count: 0};

	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => server.send(message));
		server.onMessage(async message => {
			if (
				typeof message === 'string' &&
				message.startsWith('{"type":"timeline"')
			) {
				seen.count += 1;
				if (delayMs > 0) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			}

			ws.send(message);
		});
	});

	return {
		// Resolves once a reply has arrived and no further one has followed it,
		// so what is on screen is the window that was asked for.
		settled: async () => {
			let previous = -1;

			await expect
				.poll(() => {
					const stable = seen.count > 0 && seen.count === previous;
					previous = seen.count;
					return stable;
				})
				.toBe(true);
		},
	};
};

test('the scope filter narrows the board to what the window holds, and lets go again', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();
	const scopeOnly = page.getByRole('checkbox', {name: 'Scope only'});

	// Under "All" the window is the whole log, so there is nothing to narrow.
	await expect(scopeOnly).toBeDisabled();

	const title = `Windowed ${Date.now()}`;
	await addTicket(page, title);

	const now = Date.now();

	// A window the ticket was filed inside: narrowed, and still there.
	await page.goto(zoomed(boardUrl, now - HOUR_MS, now + HOUR_MS));
	await expect(scopeOnly).toBeChecked();
	await expect(card(page, title)).toBeVisible();
	// The timeline is outlined while it is the thing doing the hiding.
	await expect(page.getByTestId('scrubber-track')).toHaveCSS(
		'outline-style',
		'solid',
	);

	// A stretch that ended before the repository existed holds no event, so it
	// holds no ticket either.
	await page.goto(zoomed(boardUrl, now - 3 * HOUR_MS, now - 2 * HOUR_MS));
	await expect(card(page, title)).toHaveCount(0);

	// And the way back out is the box itself: a quiet window must not leave it
	// disabled over an empty board.
	await expect(scopeOnly).toBeEnabled();
	await scopeOnly.click();
	await expect(card(page, title)).toBeVisible();
	await expect(page).not.toHaveURL(/window=1/);
	await expect(page.getByTestId('scrubber-track')).not.toHaveCSS(
		'outline-style',
		'solid',
	);

	// Ticked again on the same page, the ticket goes away a second time — so
	// the empty board above was the filter and not a board still loading.
	await scopeOnly.click();
	await expect(card(page, title)).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('a ticket filed while the filter is on joins the board it belongs to', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const timeline = await watchTimeline(page);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	// A window that runs up to now, and is narrowing the board already.
	await page.goto(`${boardUrl}?scope=day&window=1`);
	await expect(page.getByRole('checkbox', {name: 'Scope only'})).toBeChecked();
	await timeline.settled();

	// Filing a ticket does not move the window, and the window is what the
	// filter reads — so unless it is asked for again the new ticket is in the
	// board's state and missing from the timeline that decides what shows.
	const title = `Filed while filtering ${Date.now()}`;
	await addTicket(page, title);

	// Opening the new ticket rebuilds the query for its own route, which must
	// not quietly drop the narrowing on the way.
	await expect(page).toHaveURL(/window=1/);
	await expect(card(page, title)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('leaving the period puts every ticket back, box and all', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	// Held back so the answer for "All" is still in flight when the assertion
	// runs: what is on screen then is the board deciding for itself, off the
	// window it is leaving, rather than the new window's data covering for it.
	const timeline = await watchTimeline(page, REPLY_DELAY_MS);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const title = `Left behind ${Date.now()}`;
	await addTicket(page, title);

	const now = Date.now();
	await page.goto(zoomed(boardUrl, now - 3 * HOUR_MS, now - 2 * HOUR_MS));
	await timeline.settled();
	await expect(card(page, title)).toHaveCount(0);

	// "All" is every event there is, so there is nothing left to narrow to and
	// the box goes flat. It must not go on hiding tickets from under a control
	// that can no longer be pressed — not even for the round trip.
	await page.getByRole('button', {name: 'All', exact: true}).click();
	await expect(card(page, title)).toBeVisible({timeout: REPLY_DELAY_MS / 3});
	await expect(page.getByRole('checkbox', {name: 'Scope only'})).toBeDisabled();

	expect(pageErrors).toEqual([]);
});

test('collapsing the scrubber keeps the filter reachable', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const title = `Collapsed ${Date.now()}`;
	await addTicket(page, title);

	const now = Date.now();
	await page.goto(zoomed(boardUrl, now - 3 * HOUR_MS, now - 2 * HOUR_MS));
	await expect(card(page, title)).toHaveCount(0);

	await page.getByTitle('Hide time travel').click();
	await expect(page.getByTestId('scrubber-track')).toHaveCount(0);

	// The chart is gone but its narrowing is not, so the box has to be here.
	const scopeOnly = page.getByRole('checkbox', {name: 'Scope only'});
	await expect(scopeOnly).toBeVisible();
	await scopeOnly.click();
	await expect(card(page, title)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
