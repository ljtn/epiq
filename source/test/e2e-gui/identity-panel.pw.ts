// The identity panel: who the board thinks you are, which git addresses are
// yours, and the states nothing else on the board reports.
//
// It matters more than its size suggests. Nothing links an address on its own
// any more, so this panel and `:config emails` are the only two ways a commit
// ever comes to carry a board name — and it is the only surface that names a
// contested address at all.

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	COMMIT_CACHE_MS,
	commitLinkedFile,
	linkedFileName,
} from './linked-commit.js';

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
const AUTHOR_SCAN_CACHE_MS = 15_500;

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const openPanel = async (page: Page) => {
	await page
		.locator('button[aria-label="Your identity on this board"]')
		.click();

	const panel = page.getByTestId('identity-panel');
	await expect(panel).toBeVisible();
	return panel;
};

/**
 * A commit by `COMMIT_EMAIL`, and a page that can see it.
 *
 * The server caches the commit timeline, so a page that already asked has to
 * outlive the cache before a reload brings the new commit back.
 */
const commitAndReload = async (page: Page, repoRoot: string, tag: string) => {
	await addTicket(page, `Identity ${tag}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFile(repoRoot, ref!, `identity ${tag}`, linkedFileName(ref!));
	// The longer of the two: the timeline cache is what makes the commit
	// visible, the author scan is what makes its address offerable.
	await page.waitForTimeout(Math.max(COMMIT_CACHE_MS, AUTHOR_SCAN_CACHE_MS));
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
