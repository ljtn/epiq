// The diff stat beside a card's ref: what the ticket's commits added and took
// away, and the hairline that splits the two. A ticket no commit names draws
// nothing at all.

import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	commitLinkedFile,
	commitLinkedNothing,
	linkedFileName,
} from './linked-commit.js';

const addTicket = async (page: Page, title: string): Promise<string> => {
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	return ref!;
};

// Scoped to one ticket's own card — every worker's tests share one repo and one
// board, so other tickets on it may well have commits of their own. The row
// holding the ref is the stat's own parent; the panel's copy of the ref sits in
// a row that has no stat in it, matched or not.
const statOn = (page: Page, ref: string) =>
	page
		.locator(`div:has(> button[title="Copy ${ref}"])`)
		.getByTestId('ticket-diff');

test('a card whose ticket has commits carries its diff stat, and carries none before', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicket(page, `Coded ${Date.now()}`);
	const stat = statOn(page, ref);

	await expect(page.getByTestId('copy-ref').last()).toBeVisible();
	await expect(stat).toHaveCount(0);

	// Three lines added and none removed — `commitLinkedFile`'s own contents.
	commitLinkedFile(repoRoot, ref, 'add notes');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(stat).toHaveCount(1);
	await expect(stat).toHaveText('+3-0');
	// The one thing the figures beside it do not say.
	await expect(stat).toHaveAttribute('title', '1 commit');

	// And it is the way into what it counts, the way the comment count beside
	// it is the way into the comments: the panel opens on the Code tab, in the
	// view that draws the whole change at once — the one the stat is a picture
	// of — rather than on whichever tab and view were last used.
	await stat.click();
	await expect(page).toHaveURL(/tab=code/);
	await expect(page).toHaveURL(/diff=flat/);
	await expect(page.getByTestId('commit-card')).toHaveCount(0);
	await expect(page.getByTestId('file-row')).toContainText(linkedFileName(ref));

	expect(pageErrors).toEqual([]);
});

// The stat is the whole control, so where it draws nothing there must be
// nothing — not a button of its size with no mark in it, which is a thing to
// hover and click that cannot be seen.
test('a ticket whose commits changed no lines carries no stat to click', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const ref = await addTicket(page, `Empty ${Date.now()}`);

	commitLinkedNothing(repoRoot, ref, 'nothing to see');
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The commit is matched — the Code tab counts it — and still nothing is
	// drawn beside the ref.
	await expect(page.getByTestId('copy-ref').last()).toBeVisible();
	await expect(statOn(page, ref)).toHaveCount(0);
	await expect(
		page.getByTestId('aside-pane').getByRole('button', {name: /^Code \(1\)/}),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
});
