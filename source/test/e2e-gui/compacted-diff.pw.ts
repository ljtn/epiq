import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	COMMIT_CACHE_MS,
	commitLinkedFile,
	commitPlainFile,
	linkedFileName,
} from './linked-commit.js';

const openDiffTab = async (page: Page, appUrl: string, title: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);

	return new URL(page.url()).pathname.split('/issue/')[1]!;
};

// Two commits to one file, so the compacted diff has something to compact:
// per-commit it reads as two changes, compacted as one file going from the
// first state to the last.
test('the compacted view shows a file once, however many commits touched it', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Compacted ${Date.now()}`);
	const file = linkedFileName(ref);

	commitLinkedFile(repoRoot, ref, 'first', file, 'alpha\nbeta\n');
	commitLinkedFile(repoRoot, ref, 'second', file, 'alpha\nbeta\ngamma\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();

	// Per-commit: the file appears once per commit that touched it.
	await expect(page.getByTestId('commit-card')).toHaveCount(2);

	await page.getByRole('button', {name: 'Compacted'}).click();

	// Compacted: no commit cards at all, and the file appears once.
	await expect(page.getByTestId('commit-card')).toHaveCount(0);
	await expect(page.getByTestId('file-row')).toHaveCount(1);
	await expect(page.getByTestId('file-row')).toContainText(file);

	// The end state, not any intermediate one: the line the second commit
	// added is here, and the whole thing reads as one change.
	await expect(page.getByTestId('file-row')).toContainText('gamma');

	expect(pageErrors).toEqual([]);
});

// Decision A on TCYD699: a line in the compacted diff belongs to the ticket,
// not to any one commit, so there is nothing for a review tick to be recorded
// against and it is not offered.
test('the compacted view offers no per-commit review tick', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `No tick ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();

	const tick = page.getByTestId('file-row').getByLabel('reviewed');
	await expect(tick).toHaveCount(1);

	await page.getByRole('button', {name: 'Compacted'}).click();

	await expect(page.getByTestId('file-row')).toHaveCount(1);
	await expect(tick).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The obstacle the whole design turns on: another ticket's commit between two
// of this one's. The compacted diff is narrowed to this ticket's own files,
// and the reader is told why.
test('an interleaved commit is kept out of the compacted diff, and named', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const stamp = Date.now();
	const ref = await openDiffTab(page, appUrl, `Interleaved ${stamp}`);
	const mine = linkedFileName(ref);
	const theirs = `theirs-${stamp}.txt`;

	commitLinkedFile(repoRoot, ref, 'first', mine, 'alpha\n');
	commitPlainFile(repoRoot, theirs, 'somebody else entirely');
	commitLinkedFile(repoRoot, ref, 'second', mine, 'alpha\nbeta\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();
	await page.getByRole('button', {name: 'Compacted'}).click();

	await expect(page.getByTestId('file-row')).toHaveCount(1);
	await expect(page.getByTestId('file-row')).toContainText(mine);
	await expect(page.getByTestId('file-row')).not.toContainText(theirs);

	// The interleaving happened but missed every file this ticket touched, so
	// the diff really is exact — and the notice says that rather than warning.
	await expect(page.getByTestId('squashed-diff-notice')).toContainText(
		'touched no file this one did',
	);

	expect(pageErrors).toEqual([]);
});

test('the chosen view survives a reload', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Sticky ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();
	await page.getByRole('button', {name: 'Compacted'}).click();
	await expect(page.getByTestId('file-row')).toHaveCount(1);

	// No wait: the commit is already in the timeline this page read.
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();

	await expect(page.getByRole('button', {name: 'Compacted'})).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(page.getByTestId('commit-card')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The view is in the route so a link can name it. Without that, sending
// someone `?tab=code` hands them whichever view they last used, which need
// not be the one being talked about.
test('a link names the view, over whatever this browser last used', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Linked view ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();

	// Leave this browser remembering the commits view, so the link below is
	// overriding something rather than agreeing with it.
	await page.getByRole('button', {name: /^Diff/}).click();
	await page.getByRole('button', {name: 'Commits'}).click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code&diff=compacted`);

	await expect(page.getByRole('button', {name: 'Compacted'})).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(page.getByTestId('file-row')).toHaveCount(1);
	await expect(page.getByTestId('commit-card')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// Following one link must not re-set how every ticket opens from then on.
test('a link does not overwrite what this browser remembers', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Not sticky ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();
	await page.getByRole('button', {name: 'Commits'}).click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code&diff=compacted`);
	await expect(page.getByTestId('file-row')).toHaveCount(1);

	// Back to a URL naming no view: the reader's own choice is still commits.
	await page.goto(`${appUrl}${board}?tab=code`);
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// A URL copied out of the address bar has to carry the view even when the
// switch was never touched, which is the usual way a link gets made.
test('opening the tab puts the view in the address bar', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Address bar ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Diff/}).click();

	await expect(page).toHaveURL(/[?&]diff=(commits|compacted)\b/);

	expect(pageErrors).toEqual([]);
});
