// S021YSM: the log lists only what the board on screen can act on.
//
// A line's route is built from the board being looked at (`openIssueTab`
// defaults `board = boardSlug`), so a line belonging to another board's ticket
// leads somewhere that board does not hold.

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {commitLinkedFile} from './linked-commit.js';

const QA_TICKET = 'A ticket that lives on QA';

const switchToBoard = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: name})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
};

const addTicket = async (page: Page, title: string) => {
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

// The All-boards flag has no control on the bar today — its checkbox is
// commented out — so the only way a reader holds it is a value left in this
// origin's storage by a build where it had one. That is the case under test:
// the window then returns other boards' events and the log has to leave them
// out.
test('a ticket filed on another board is left out of this board’s log', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.addInitScript(() => {
		try {
			localStorage.setItem('epiq.timeScrubber.allBoards', 'true');
		} catch {
			// A private window refuses storage; the assertion below still holds,
			// it just no longer exercises the foreign-line case.
		}
	});

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// A board created by `:new board` arrives with no swimlanes, and a ticket
	// needs one to live in.
	await switchToBoard(page, 'QA');
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill('QA lane');
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(page.getByText('QA lane')).toBeVisible();

	await addTicket(page, QA_TICKET);

	await switchToBoard(page, 'Default');

	await page.getByTestId('log-toggle').click();
	const log = page.getByTestId('event-log');
	await expect(log).toBeVisible();

	// Scoped to the log rather than the page: the ticket is on the board behind
	// the panel too, and a page-wide check would pass on that instead.
	await expect(log).not.toContainText(QA_TICKET);

	// The panel is listing this board's own lines, so the absence above is a
	// filter doing its job rather than an empty log.
	await expect(log.getByText(/filed|added|created/i).first()).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// 89HF7NW: the Code series' lines answer to the same rule. A commit's line is
// linked to a ticket, and a ticket on another board leads the same way nowhere
// — so under `Linked` a board lists the commits naming its own tickets, not the
// repository's.
test('a commit linked to another board’s ticket is left out of this board’s log', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	await addTicket(page, `Default ticket ${stamp}`);

	const ref = (
		await page.locator('aside').getByTestId('copy-ref').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	const subject = `default work ${stamp}`;
	commitLinkedFile(repoRoot, ref!, subject);

	await page.reload();
	await page.getByTestId('log-toggle').click();
	const log = page.getByTestId('event-log');
	await expect(log).toBeVisible();

	const select = page.getByTestId('commit-select');
	await select.click();
	await page.getByRole('radio', {name: 'Linked to a ticket'}).click();
	await expect(select).toHaveText('Linked');

	const line = log.getByTestId('log-line').filter({hasText: subject});
	await expect(line).toHaveCount(1);

	await switchToBoard(page, 'QA');
	await expect(line).toHaveCount(0);

	// Back where the ticket lives it returns, so the absence above is this
	// board's narrowing and not a commit the log had lost.
	await switchToBoard(page, 'Default');
	await expect(line).toHaveCount(1);

	// Closing takes the ticket to the global Closed board, which is every
	// board's. The work was still this board's, and a board whose finished
	// tickets took their commits with them would list almost none.
	//
	// The card rather than the log line below it, which carries the same title.
	await page
		.locator('div[draggable="true"]')
		.filter({hasText: `Default ticket ${stamp}`})
		.first()
		.click();
	// This ticket and no other: the palette closes whichever one is open, and
	// every card on the board carries a `copy-ref` of its own.
	await expect(page).toHaveURL(new RegExp(`/issue/${ref}`));
	await page.keyboard.press('Control+k');
	await expect(page.getByTestId('command-palette')).toBeVisible();
	await page.keyboard.type('close ticket');

	const closeRow = page
		.getByTestId('command-palette')
		.getByRole('option')
		.first();
	await expect(closeRow).toContainText('Close ticket');
	// A command it cannot run yet is listed with its reason rather than hidden,
	// and Enter on one does nothing at all — so wait for the ticket just opened
	// to reach the palette's context rather than typing into the gap.
	await expect(closeRow).not.toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('command-palette')).toBeHidden();

	// The card has left this board's columns, so the close really landed — the
	// assertion below would pass on an unclosed ticket otherwise.
	await expect(
		page
			.locator('div[draggable="true"]')
			.filter({hasText: `Default ticket ${stamp}`}),
	).toHaveCount(0, {timeout: 30_000});

	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(line).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});
