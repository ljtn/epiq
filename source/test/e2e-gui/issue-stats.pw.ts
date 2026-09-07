import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFiles} from './linked-commit.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

test('the Stats tab measures the ticket own commits', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	await addTicket(page, `Stats ${Date.now()}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// One code file and one test file, so the ratio, the language split and
	// the comment share all have something real to report.
	commitLinkedFiles(repoRoot, ref!, 'add a parser', {
		[`parser-${ref}.ts`]: [
			'// Why this exists.',
			'export const parse = (raw: string) => JSON.parse(raw);',
			'',
		].join('\n'),
		[`parser-${ref}.test.ts`]: [
			"import {parse} from './parser.js';",
			"it('parses', () => expect(parse('{}')).toEqual({}));",
			'',
		].join('\n'),
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();

	await page.getByRole('button', {name: /^Stats/}).click();

	// The shape of the change, from the patch itself.
	await expect(page.getByText('Files', {exact: true})).toBeVisible();
	await expect(page.getByText('Directories', {exact: true})).toBeVisible();

	// The test signal: one test line per code line, and one test file added.
	await expect(page.getByText('Test lines added')).toBeVisible();
	await expect(page.getByText('Test file added')).toBeVisible();

	// Named twice on the page — once for its share of the change, once for its
	// comment share — so this is the first, not the only.
	await expect(
		page.getByText('TypeScript', {exact: true}).first(),
	).toBeVisible();

	// And drawn: the language bar carries a segment per language, each naming
	// its own share.
	await expect(page.getByTitle(/^TypeScript — \d+%$/)).toBeVisible();

	// One author, counted off the commits rather than off the board — the
	// ticket has no assignee at all, so a board-sourced count would be zero.
	// The name itself is not shown; the singular label is what says it is one.
	await expect(page.getByText('Author', {exact: true})).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The point of the tab is to send somebody somewhere. A path that only
// describes a file is half a stat.
test('a file named on the Stats tab opens its own diff', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	await addTicket(page, `Follow ${Date.now()}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFiles(repoRoot, ref!, 'add a parser', {
		[`parser-${ref}.ts`]: ['export const parse = () => 1;', ''].join('\n'),
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await page.getByRole('button', {name: /^Stats/}).click();

	// The largest file of a one-file change is that file.
	await page
		.getByRole('button', {name: new RegExp(`parser-${ref}\\.ts`)})
		.first()
		.click();

	// Landed on the Commits tab, with that file's diff open.
	await expect(page).toHaveURL(new RegExp(`tab=code.*file=parser-${ref}`));
	await expect(
		page.getByRole('button', {name: `parser-${ref}.ts`}),
	).toHaveAttribute('aria-expanded', 'true');

	expect(pageErrors).toEqual([]);
});

// A ticket nobody has started is exactly when how long it has been sitting is
// the whole story, so the board figures stay even with no code to measure.
test('a ticket with no commits still says how long it has been sitting', async ({
	page,
	pageErrors,
}) => {
	await addTicket(page, `Unstarted ${Date.now()}`);

	await page.getByRole('button', {name: /^Stats/}).click();

	await expect(page.getByText(/No commit carries this ticket/)).toBeVisible();

	await expect(page.getByText('Days old')).toBeVisible();
	await expect(page.getByText('Times sent back')).toBeVisible();
	// The lane the seeded board files a new ticket into, named in the label.
	await expect(page.getByText(/^Days in /)).toBeVisible();

	expect(pageErrors).toEqual([]);
});
