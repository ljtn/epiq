// The diff stat beside a card's ref: what the ticket's commits added and took
// away, and the hairline that splits the two. A ticket no commit names draws
// nothing at all.

import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFile} from './linked-commit.js';

test('a card whose ticket has commits carries its diff stat, and carries none before', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Coded ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Coded ${stamp}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// Scoped to this ticket's own card — every worker's tests share one repo and
	// one board, so other tickets on it may well have commits of their own. The
	// row holding the ref is the stat's own parent; the panel's copy of the ref
	// sits in a row that has no stat in it, matched or not.
	const stat = page
		.locator(`div:has(> button[title="Copy ${ref}"])`)
		.getByTestId('ticket-diff');

	await expect(page.getByTitle(`Copy ${ref}`).last()).toBeVisible();
	await expect(stat).toHaveCount(0);

	// Three lines added and none removed — `commitLinkedFile`'s own contents.
	commitLinkedFile(repoRoot, ref!, 'add notes');
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(stat).toHaveCount(1);
	await expect(stat).toHaveText('+3-0');
	// The one thing the figures beside it do not say.
	await expect(stat).toHaveAttribute('title', '1 commit');

	// And it is the way into what it counts, the way the comment count beside
	// it is the way into the comments: the panel opens on the Code tab rather
	// than on whichever tab was last used.
	await stat.click();
	await expect(page).toHaveURL(/tab=code/);
	await expect(
		page.getByRole('button', {name: 'add notes +3 -0'}),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
});
