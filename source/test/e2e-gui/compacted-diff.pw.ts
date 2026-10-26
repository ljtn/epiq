import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	commitLinkedFile,
	commitPlainFile,
	linkedFileName,
} from './linked-commit.js';

const openDiffTab = async (page: Page, appUrl: string, title: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('ticket name').fill(title);
	await page.getByPlaceholder('ticket name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);

	return new URL(page.url()).pathname.split('/issue/')[1]!;
};

// Two commits to one file: per-commit two changes, compacted one.
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

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();

	// Per-commit: the file appears once per commit that touched it.
	await expect(page.getByTestId('commit-card')).toHaveCount(2);

	await page.getByRole('button', {name: 'Diff', exact: true}).click();

	// Compacted: no commit cards at all, and the file appears once.
	await expect(page.getByTestId('commit-card')).toHaveCount(0);
	await expect(page.getByTestId('file-row')).toHaveCount(1);
	await expect(page.getByTestId('file-row')).toContainText(file);

	// The end state, not any intermediate one: the line the second commit
	// added is here, and the whole thing reads as one change.
	await expect(page.getByTestId('file-row')).toContainText('gamma');

	expect(pageErrors).toEqual([]);
});

// Each row carries the last of the ticket's commits to touch that file, for
// the tick to be recorded against.
test('a file ticked off in one view is ticked off in the other', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Shared tick ${Date.now()}`);
	const file = linkedFileName(ref);

	commitLinkedFile(repoRoot, ref, 'only', file, 'alpha\n');

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Diff', exact: true}).click();

	const tick = page.getByTestId('file-row').getByLabel('reviewed');
	await expect(tick).toHaveCount(1);
	await tick.check();

	// One commit touched this file, so both views share its tick.
	await page.getByTestId('diff-view-commits').click();
	await expect(
		page.getByTestId('file-row').getByLabel('reviewed'),
	).toBeChecked();

	expect(pageErrors).toEqual([]);
});

// The ticket's newest commit did not touch this file, so it must not be the anchor.
test('a comment in the compacted view lands on the commit that touched the file', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const stamp = Date.now();
	const ref = await openDiffTab(page, appUrl, `Anchored ${stamp}`);

	const early = linkedFileName(ref);
	const late = `late-${stamp}.txt`;

	const earlySha = commitLinkedFile(repoRoot, ref, 'first', early, 'alpha\n');
	const lateSha = commitLinkedFile(repoRoot, ref, 'second', late, 'beta\n');

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Diff', exact: true}).click();

	// Comment on the file the *newest* commit never touched.
	const row = page.getByTestId('file-row').filter({hasText: early});
	await row.locator('[data-column-number]').first().click();

	const composer = page.getByTestId('selection-composer');
	await expect(composer).toBeVisible();
	await expect(composer).toContainText(`${early} line 1`);
	await composer.getByPlaceholder(/add a note/i).fill('anchored here');
	await composer.getByRole('button', {name: 'Comment'}).click();

	await expect(page.getByText('anchored here').first()).toBeVisible();

	// The comment's permalink opens the commit it anchored to.
	await page.getByRole('button', {name: /^Comments/}).click();
	await page.locator('aside').getByTestId('open-in-diff').first().click();

	await expect(page).toHaveURL(new RegExp(`commit=${earlySha}`));
	await expect(page).not.toHaveURL(new RegExp(`commit=${lateSha}`));

	expect(pageErrors).toEqual([]);
});

// Another ticket's commit between two of this one's narrows the compacted diff, with a note why.
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

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Diff', exact: true}).click();

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

// Arrives at a URL naming no view, since a reload would keep the query param.
test('the chosen view is remembered for a link that names none', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Sticky ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Diff', exact: true}).click();
	await expect(page.getByTestId('file-row')).toHaveCount(1);

	// Compacted rather than commits deliberately: commits is the default, so a
	// test that ended there would pass with storage never written at all.
	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code`);

	await expect(
		page.getByRole('button', {name: 'Diff', exact: true}),
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('commit-card')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// A link pins one visit to one tab, not the session: stepping off the Code tab
// and back is the reader browsing on their own again.
test('leaving the tab lets go of the view a link named', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Let go ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.reload();

	// This browser remembers commits; the link below says compacted.
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByTestId('diff-view-commits').click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code&diff=flat`);
	await expect(page.getByTestId('file-row')).toHaveCount(1);

	await page.getByRole('button', {name: /^Comments/}).click();
	// The pin goes with the tab it was for, rather than riding along on a URL
	// copied from a tab that has no view to name.
	await expect(page).not.toHaveURL(/[?&]diff=/);

	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// The view is in the route so a link can name it.
test('a link names the view, over whatever this browser last used', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Linked view ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.reload();

	// Leave this browser remembering the commits view, so the link below is
	// overriding something rather than agreeing with it.
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByTestId('diff-view-commits').click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code&diff=flat`);

	await expect(
		page.getByRole('button', {name: 'Diff', exact: true}),
	).toHaveAttribute('aria-pressed', 'true');
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

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByTestId('diff-view-commits').click();
	await expect(page.getByTestId('commit-card')).toHaveCount(1);

	const board = new URL(page.url()).pathname;
	await page.goto(`${appUrl}${board}?tab=code&diff=flat`);
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

	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();

	await expect(page).toHaveURL(/[?&]diff=(commits|flat)\b/);

	expect(pageErrors).toEqual([]);
});

// Two effects replace the query independently; they converge only because each
// re-derives what it owns. Pinned so that stays checked.
test('a board selection and the diff view survive each other', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();

	for (const name of [`Both a ${stamp}`, `Both b ${stamp}`]) {
		await page.getByTestId('add-issue').first().click();
		await page.getByPlaceholder('ticket name').fill(name);
		await page.getByPlaceholder('ticket name').press('Enter');
		// This ticket's own panel: a loose `/issue/` check passes early on the second pass.
		await expect(page.locator('aside')).toContainText(name);
	}

	await page.goto(boardUrl);
	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await expect(page).toHaveURL(/scope=week/);

	await page.getByText(`Both a ${stamp}`).click();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await expect(page).toHaveURL(/diff=/);

	// The click that rebuilds the query from `?tab=` alone.
	await page.getByText(`Both b ${stamp}`).click();

	await expect(page).toHaveURL(/scope=week/);
	await expect(page).toHaveURL(/diff=(commits|flat)/);

	expect(pageErrors).toEqual([]);
});
