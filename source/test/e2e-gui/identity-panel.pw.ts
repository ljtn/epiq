// The identity panel: who the board thinks you are, which git addresses are
// yours, and the states nothing else on the board reports.
//
// It matters more than its size suggests. Nothing links an address on its own
// any more, so this panel and `:config emails` are the only two ways a commit
// ever comes to carry a board name — and it is the only surface that names a
// contested address at all.

import fs from 'node:fs';
import path from 'node:path';
import type {Page} from '@playwright/test';
import {expect, readHandoff, test} from './fixtures.js';
import {addTicket} from './ticket.js';
import {commitLinkedFile, linkedFileName} from './linked-commit.js';

// Whoever the seeded TUI configured, and the address `commitLinkedFile` signs
// its commits with. Neither resembles the other, which is the point: the panel
// has to offer an address that matches nothing the viewer is called.
const BOARD_NAME = 'claude/tester';
// What the panel draws: a board name is shown from its last slash, so the two
// `claude/...` sessions on a board are told apart without the prefix repeating.
const SHOWN_NAME = '/tester';
const COMMIT_EMAIL = 'e2e@example.com';

// The scan of a repository's authors is cached for this long, so an address
// that has just made its first commit is not offered until the walk runs again.
const openPanel = async (page: Page) => {
	await page
		.locator('button[aria-label="Your identity on this board"]')
		.click();

	const panel = page.getByTestId('identity-panel');
	await expect(panel).toBeVisible();
	return panel;
};

/** A commit by `COMMIT_EMAIL`, and a page that can see it. */
const commitAndReload = async (page: Page, repoRoot: string, tag: string) => {
	await addTicket(page, `Identity ${tag}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFile(repoRoot, ref!, `identity ${tag}`, linkedFileName(ref!));
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	return ref!;
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the avatar opens who you are, and Escape closes it', async ({
	page,
	pageErrors,
}) => {
	await expect(page.getByTestId('identity-panel')).toHaveCount(0);

	const panel = await openPanel(page);
	await expect(panel).toContainText(SHOWN_NAME);

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('identity-panel')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The panel is portalled out of the header to escape the clipping there, so a
// click inside it is not a click inside the trigger. Without the panel being
// named as inside, it closed the moment anybody used it.
test('a click inside the panel does not dismiss it', async ({
	page,
	pageErrors,
}) => {
	const panel = await openPanel(page);

	// The heading, because it is inside the panel and does nothing when clicked:
	// a button would prove the click landed but not that the panel survived it.
	await panel.getByText('on this board').click();
	await expect(panel).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// It draws every address in the history on purpose, so on any real repository
// the list is taller than the window. Without a cap it ran off the bottom: the
// panel's own edge went over the fold and the rows below it were unreachable.
//
// The seeded history holds too few addresses to overflow anything, so this
// pins the structure that makes overflow survivable rather than an overflowing
// list: the panel stays inside the window, the addresses sit in a region that
// scrolls, and the line saying who you are sits outside it.
test('the addresses scroll inside a panel that stays in the window', async ({
	page,
	pageErrors,
}) => {
	await page.setViewportSize({width: 1280, height: 320});

	const panel = await openPanel(page);
	await expect(
		panel.locator('[data-testid^="identity-row-"]').first(),
	).toBeVisible();

	const measured = await page.evaluate<{
		bottom: number;
		viewport: number;
		scrollerHoldsRows: boolean;
		scrollerHoldsHeading: boolean;
	}>(`
		(() => {
			const panel = document.querySelector('[data-testid="identity-panel"]');
			const box = panel.getBoundingClientRect();
			const scroller = [...panel.children].find(
				child => getComputedStyle(child).overflowY === 'auto',
			);
			const row = panel.querySelector('[data-testid^="identity-row-"]');

			return {
				bottom: Math.round(box.bottom),
				viewport: window.innerHeight,
				scrollerHoldsRows: Boolean(scroller && row && scroller.contains(row)),
				scrollerHoldsHeading: Boolean(
					scroller && scroller.textContent.includes('on this board'),
				),
			};
		})()
	`);

	expect(measured.bottom).toBeLessThanOrEqual(measured.viewport);
	expect(measured.scrollerHoldsRows).toBe(true);
	expect(measured.scrollerHoldsHeading).toBe(false);

	expect(pageErrors).toEqual([]);
});

// The two settings that were the TUI's alone.
//
// The config is restored through the filesystem rather than the panel, as
// `follow-arrival.pw.ts` does. A worker runs several files over its life and
// they all share this one `config.json`, so the restore has to be one that
// cannot quietly decline: putting a sub-floor value back through the field
// would be refused by the field, and the 37s written here would leak into
// every later file on the worker.
test('auto sync and its interval are editable, and survive a reload', async ({
	page,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		const panel = await openPanel(page);
		const interval = panel.getByTestId('autosync-interval');
		await expect(interval).toBeVisible();

		await interval.fill('37');
		await interval.press('Enter');

		// Reopening is what proves the server took it: the panel asks again on
		// open, and frames on one socket are answered in order, so that reply
		// cannot overtake the write. Reloading straight away would race it.
		await page.keyboard.press('Escape');
		await openPanel(page);
		await expect(page.getByTestId('autosync-interval')).toHaveValue('37');

		// And now the file, which is the only thing that outlives the page.
		await page.reload();
		await expect(page.getByTestId('board-switcher')).toContainText('Default');
		await openPanel(page);
		await expect(page.getByTestId('autosync-interval')).toHaveValue('37');

		// The floor, refused in the field rather than after a round trip, and
		// the field falls back to what is configured rather than keeping a
		// value nothing accepted.
		const reopened = page.getByTestId('autosync-interval');
		await reopened.fill('1');
		await expect(page.getByTestId('identity-panel')).toContainText(
			'3 seconds is the shortest interval',
		);
		await reopened.blur();
		await expect(reopened).toHaveValue('37');

		// And the toggle, which is the setting the interval is about.
		const was = await page
			.getByTestId('autosync-toggle')
			.locator('input')
			.isChecked();

		await page.getByTestId('autosync-toggle').click();
		await expect(
			page.getByTestId('autosync-toggle').locator('input'),
		).toBeChecked({checked: !was});

		await page.getByTestId('autosync-toggle').click();
		await expect(
			page.getByTestId('autosync-toggle').locator('input'),
		).toBeChecked({checked: was});

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});

// A stored value below the floor is a state the loops keep on purpose, and
// the suites write one. The panel has to draw it without calling it an error:
// flagging it on sight opened with a red message against a number nobody
// typed, and `commit` wrote the same number back, so it could not be cleared.
test('a configured interval under the floor is shown, not flagged', async ({
	page,
	pageErrors,
}, testInfo) => {
	const configPath = path.join(
		readHandoff(testInfo.parallelIndex).globalDir,
		'config.json',
	);
	const original = fs.readFileSync(configPath, 'utf8');

	try {
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{...JSON.parse(original), autoSyncDebounceMs: 1000},
				null,
				2,
			),
		);

		await page.reload();
		await expect(page.getByTestId('board-switcher')).toContainText('Default');

		const panel = await openPanel(page);
		await expect(panel.getByTestId('autosync-interval')).toHaveValue('1');
		await expect(panel).not.toContainText('shortest interval');

		// And it stays quiet through a blur, rather than the field rewriting
		// its own value and raising the error again.
		await panel.getByTestId('autosync-interval').click();
		await panel.getByTestId('autosync-interval').blur();
		await expect(panel.getByTestId('autosync-interval')).toHaveValue('1');
		await expect(panel).not.toContainText('shortest interval');

		expect(pageErrors).toEqual([]);
	} finally {
		fs.writeFileSync(configPath, original);
	}
});

// Four figures about the person reading, not about a ticket or a lane.
//
// Measured as a difference rather than against a number. The seeded board
// carries whatever the seed and the files before this one left on it, so the
// only honest assertion is that filing a ticket moves the figure that counts
// tickets — which is also the one that proves the row is counting rather than
// drawing whatever it was handed.
const ticketsOpened = async (page: Page): Promise<number> => {
	const row = page
		.getByTestId('identity-stats')
		.locator('div', {hasText: /^tickets opened/})
		.last();

	await expect(row).toBeVisible();

	return Number((await row.textContent())?.replace(/\D+/g, ''));
};

test('the panel counts your own tickets, and the count follows the board', async ({
	page,
	pageErrors,
}) => {
	const panel = await openPanel(page);
	await expect(panel.getByTestId('identity-stats')).toContainText('commits');
	await expect(panel.getByTestId('identity-stats')).toContainText('comments');

	// Somebody has been here, so the board knows when they arrived.
	await expect(panel.getByTestId('identity-stats')).not.toContainText(
		'joined not yet',
	);

	const before = await ticketsOpened(page);

	await page.keyboard.press('Escape');
	await addTicket(page, `Counted ${Date.now()}`);

	// Re-opening is what asks again: the totals are fetched on opening the
	// panel, not pushed with every board broadcast.
	await openPanel(page);
	await expect.poll(() => ticketsOpened(page)).toBe(before + 1);

	expect(pageErrors).toEqual([]);
});

test('claiming an address makes its commits read as you, and unlinking undoes it', async ({
	page,
	repoRoot,
	pageErrors,
}) => {
	const stamp = Date.now();
	await commitAndReload(page, repoRoot, `${stamp}`);

	// Before: the log calls the commit by the name git signed it with.
	await page.getByTestId('log-toggle').click();
	await expect(page.locator('.epiq-log-actor').first()).toBeVisible();
	await expect(
		page.locator('.epiq-log-actor', {hasText: 'e2e'}),
	).not.toHaveCount(0);

	let panel = await openPanel(page);

	// The address matches nothing the viewer is called, so it sits behind the
	// disclosure rather than among the likely ones — which is the case somebody
	// with an old job's address actually meets.
	const more = panel.getByRole('button', {name: /more address/});
	if (await more.count()) await more.click();

	const row = panel.getByTestId(`identity-row-${COMMIT_EMAIL}`);
	await expect(row).toContainText(COMMIT_EMAIL);
	await row.getByRole('button', {name: 'This is me'}).click();

	// No reload: claiming refetches the commit track itself.
	await expect(
		page.locator('.epiq-log-actor', {hasText: BOARD_NAME.split('/')[1]!}),
	).not.toHaveCount(0);
	await expect(page.locator('.epiq-log-actor', {hasText: 'e2e'})).toHaveCount(
		0,
	);

	// And back: the address stops resolving, which is all unlinking promises.
	panel = page.getByTestId('identity-panel');
	await panel
		.getByTestId(`identity-row-${COMMIT_EMAIL}`)
		.getByRole('button', {name: 'Unclaim'})
		.click();

	await expect(
		page.locator('.epiq-log-actor', {hasText: 'e2e'}),
	).not.toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
