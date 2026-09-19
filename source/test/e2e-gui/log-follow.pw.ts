// TQ3W5RF: following the log — a new line that leads somewhere opens itself.
//
// What a *remote* write does is not asserted here. An ordinary mutation is
// answered by `sendStateAfterMutation`, which unicasts to the socket that made
// it; only time travel broadcasts. So a second client's write reaches a
// follower through autosync alone, which is a 15s poll and not a thing to hang
// a browser test on. The decision itself is `follow-log.test.ts`.

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

	// Filing a ticket is itself reaching for the board, so following lets go —
	// the reader has started working rather than watching. The ordinary path
	// still runs: the ticket is filed and opened as it always was.
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill('A followed ticket');
	await page.getByPlaceholder('issue name').press('Enter');

	// Both the log and the ticket panel are asides, and the log holds the
	// ticket's name too — on the line that named it. Scoped to the one that is
	// not the log, or this passes on the log line it is meant to be following.
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

// Following needs the log — its lines are what is followed — so asking for it
// from the bar opens the panel rather than leaving a control that is on and
// inert, and says so in a band the board cannot be mistaken for.
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

// The banner promises "click anywhere", and the ticket panel is a sibling of
// the board rather than a child of it — so a tab changed there reached nothing
// while the handler sat on <main>. jola hit this in a browser.
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
	await page.getByPlaceholder('issue name').fill('A ticket with tabs');
	await page.getByPlaceholder('issue name').press('Enter');

	const ticketPanel = page
		.locator('aside')
		.filter({hasNot: page.getByTestId('event-log-header')});
	await expect(ticketPanel).toContainText('A ticket with tabs');

	// On the bar, so asking to go live is not itself reaching for the board.
	const follow = page.getByTestId('live-toggle');
	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	// Scoped to the panel: the scrubber bar has a Code series button of its own,
	// and a page-wide match would find that instead — which is on the bar, and
	// so is deliberately not a release.
	await ticketPanel.getByRole('button', {name: /^Comments/}).click();

	await expect(follow).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('follow-banner')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
