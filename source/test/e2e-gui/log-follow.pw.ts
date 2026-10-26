// Following the log: a new line that leads somewhere opens itself. Remote
// writes are `follow-arrival.pw.ts`'s, as they arrive only via autosync.

import {expect, test} from './fixtures.js';

test('filing a ticket yourself is reaching for the board, and lets following go', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const follow = page.getByTestId('live-toggle');
	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	// Filing a ticket stops following; the ticket is still filed and opened.
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill('A followed ticket');
	await page.getByPlaceholder('ticket name').press('Enter');

	// Not the log aside, which also holds the ticket's name.
	const ticketPanel = page
		.locator('aside')
		.filter({hasNot: page.getByTestId('event-log-header')});
	await expect(ticketPanel).toContainText('A followed ticket');
	await expect(page.getByTestId('event-log')).toBeVisible();
	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	expect(pageErrors).toEqual([]);
});

// Scrolling the log back only pauses following; taking the board back leaves
// it, and the toggle has to say so.
test('touching the board leaves following', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const follow = page.getByTestId('live-toggle');
	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	// A card is the ordinary way in, and opening one by hand is the reader
	// saying they want the board rather than the log's next line.
	await page.locator('[draggable="true"]').first().click();

	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	expect(pageErrors).toEqual([]);
});

test('following is off until it is asked for, and lets go again', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const follow = page.getByTestId('live-toggle');
	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	expect(pageErrors).toEqual([]);
});

// Going live opens the log and shows the banner.
test('asking to go live opens the log and raises the banner', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(page.getByTestId('event-log')).toHaveCount(0);
	await expect(page.getByTestId('follow-banner')).toHaveCount(0);

	await page.getByTestId('live-toggle').click();

	await expect(page.getByTestId('event-log')).toBeVisible();
	await expect(page.getByTestId('follow-banner')).toContainText('LIVE');

	await page.getByTestId('live-toggle').click();
	await expect(page.getByTestId('follow-banner')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The ticket panel is a sibling of the board, so its clicks must release following too.
test('changing a tab in the ticket panel leaves following', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Filing one opens the panel, which is the reliable way to have tabs to
	// click — the board's own cards are not what `[draggable]` finds first.
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill('A ticket with tabs');
	await page.getByPlaceholder('ticket name').press('Enter');

	const ticketPanel = page
		.locator('aside')
		.filter({hasNot: page.getByTestId('event-log-header')});
	await expect(ticketPanel).toContainText('A ticket with tabs');

	// On the bar, so asking to go live is not itself reaching for the board.
	const follow = page.getByTestId('live-toggle');
	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	// Scoped to the panel: the bar's Code button is deliberately not a release.
	await ticketPanel.getByRole('button', {name: /^Comments/}).click();

	await expect(follow).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('follow-banner')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// Pressing LIVE opens the newest line at once.
test('going live opens the newest line at once', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Two, so the newest line leads somewhere other than where we then sit.
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill('The older one');
	await page.getByPlaceholder('ticket name').press('Enter');

	const ticketPanel = page
		.locator('aside')
		.filter({hasNot: page.getByTestId('event-log-header')});
	await expect(ticketPanel).toContainText('The older one');

	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill('The newest one');
	await page.getByPlaceholder('ticket name').press('Enter');
	await expect(ticketPanel).toContainText('The newest one');

	// Walk away from it by hand, which also leaves following if it were on.
	await page.getByTestId('board-switcher').click();
	await page.keyboard.press('Escape');
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('live-toggle').click();

	// Straight there, with no event having arrived.
	await expect(ticketPanel).toContainText('The newest one');
	await expect(page.getByTestId('live-toggle')).toHaveAttribute(
		'aria-pressed',
		'true',
	);

	expect(pageErrors).toEqual([]);
});
