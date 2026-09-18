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

// TCYD699 decided B: each row carries the last of the ticket's commits to
// touch that file, so there is something for a tick to be recorded against.
test('a file ticked off in one view is ticked off in the other', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Shared tick ${Date.now()}`);
	const file = linkedFileName(ref);

	commitLinkedFile(repoRoot, ref, 'only', file, 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Diff', exact: true}).click();

	const tick = page.getByTestId('file-row').getByLabel('reviewed');
	await expect(tick).toHaveCount(1);
	await tick.check();

	// One commit touched this file, so both views key the tick the same way
	// and it is the same tick. Where several of a ticket's commits touched a
	// file, the compacted view's tick belongs to the last of them — the
	// earlier commits' copies are a different diff and stay unticked.
	await page.getByRole('button', {name: 'Commits'}).click();
	await expect(
		page.getByTestId('file-row').getByLabel('reviewed'),
	).toBeChecked();

	expect(pageErrors).toEqual([]);
});

// The case literal "anchor to the newest sha" gets wrong: the ticket's newest
// commit did not touch this file, so a comment anchored there would name a
// commit whose diff has no such file.
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

	await page.waitForTimeout(COMMIT_CACHE_MS);
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

	// Following the comment's own permalink is what says where it anchored:
	// the commit it opens is the one recorded in the marker. Anchoring to the
	// ticket's newest commit instead would name `second`, whose diff has no
	// such file.
	await page.getByRole('button', {name: /^Comments/}).click();
	await page
		.locator('aside')
		.getByTitle('Open this in the diff')
		.first()
		.click();

	await expect(page).toHaveURL(new RegExp(`commit=${earlySha}`));
	await expect(page).not.toHaveURL(new RegExp(`commit=${lateSha}`));

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

// A reload would not prove this: choosing a view writes it into the route as
// well, and the query survives a reload — so the assertion would hold on the
// param alone with the remembered half torn out. Arriving at a URL that names
// no view is what asks storage the question.
test('the chosen view is remembered for a link that names none', async ({
	page,
	appUrl,
	repoRoot,
	pageErrors,
}) => {
	const ref = await openDiffTab(page, appUrl, `Sticky ${Date.now()}`);

	commitLinkedFile(repoRoot, ref, 'only', linkedFileName(ref), 'alpha\n');

	await page.waitForTimeout(COMMIT_CACHE_MS);
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

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();

	// This browser remembers commits; the link below says compacted.
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Commits'}).click();
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
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Commits'}).click();
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

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
	await page.getByRole('button', {name: 'Commits'}).click();
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

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();

	await expect(page).toHaveURL(/[?&]diff=(commits|flat)\b/);

	expect(pageErrors).toEqual([]);
});

// Two effects replace the query independently — this one and the board
// selection's — and React Router builds each updater's input from the
// render-time params rather than chaining them, so within a commit they do not
// compose. They converge because both re-derive from what they own rather than
// from the URL they read, and `selectIssue` rebuilding the query from `?tab=`
// is where that gets exercised. Pinned here so the convergence is a checked
// property rather than an assumption about hook declaration order.
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
		await page.getByTitle('Add issue').first().click();
		await page.getByPlaceholder('issue name').fill(name);
		await page.getByPlaceholder('issue name').press('Enter');
		await expect(page).toHaveURL(/\/issue\//);
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
