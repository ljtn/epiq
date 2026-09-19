// TQ3W5RF: following the log — a new line that leads somewhere opens itself.
//
// What a *remote* write does is not asserted here. An ordinary mutation is
// answered by `sendStateAfterMutation`, which unicasts to the socket that made
// it; only time travel broadcasts. So a second client's write reaches a
// follower through autosync alone, which is a 15s poll and not a thing to hang
// a browser test on. The decision itself is `follow-log.test.ts`.

import {expect, test} from './fixtures.js';

test('the log opens a line that arrives while it is followed', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('log-toggle').click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	const follow = page.getByTestId('log-follow');
	await expect(follow).toHaveAttribute('aria-pressed', 'false');
	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	// Filing a ticket writes a line that leads to it. The board would open it
	// anyway, so what is asserted below is the state after both — the point of
	// the case is that following does not break the ordinary path, and that the
	// toggle survives a navigation it caused.
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
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	expect(pageErrors).toEqual([]);
});

test('following is off until it is asked for, and lets go again', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('log-toggle').click();

	const follow = page.getByTestId('log-follow');
	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'true');

	await follow.click();
	await expect(follow).toHaveAttribute('aria-pressed', 'false');

	expect(pageErrors).toEqual([]);
});
