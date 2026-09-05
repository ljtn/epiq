import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFiles} from './linked-commit.js';

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

const refOf = async (page: Page): Promise<string> => {
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	return ref!;
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// Reviewing a commit file by file: what is ticked off folds away, and stays
// ticked off across a reload, so what is open is what is left to read.
test('a file ticked off as reviewed folds, and arrives folded next time', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	const stamp = Date.now();
	await addTicket(page, `Review ${stamp}`);
	const ref = await refOf(page);

	const files = [`review-${ref}-a.txt`, `review-${ref}-b.txt`];
	commitLinkedFiles(repoRoot, ref, 'two files', {
		[files[0]!]: 'alpha\nbeta\n',
		[files[1]!]: 'gamma\ndelta\n',
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Review ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: 'two files'}).click();

	const row = (fileName: string) =>
		page.getByTestId('file-row').filter({hasText: fileName});
	const toggle = (fileName: string) =>
		page.getByRole('button', {name: fileName});
	const reviewed = (fileName: string) =>
		row(fileName).getByRole('checkbox', {name: 'reviewed'});

	// Both open on arrival, neither ticked.
	await expect(toggle(files[0]!)).toHaveAttribute('aria-expanded', 'true');
	await expect(toggle(files[1]!)).toHaveAttribute('aria-expanded', 'true');
	await expect(reviewed(files[0]!)).not.toBeChecked();

	// Ticking one off folds it; the other is untouched.
	await reviewed(files[0]!).check();
	await expect(toggle(files[0]!)).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle(files[1]!)).toHaveAttribute('aria-expanded', 'true');

	// Folded, it can still be opened for another look without unticking it.
	await toggle(files[0]!).click();
	await expect(toggle(files[0]!)).toHaveAttribute('aria-expanded', 'true');
	await expect(reviewed(files[0]!)).toBeChecked();

	// The tick outlives the tab.
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Review ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: 'two files'}).click();

	await expect(reviewed(files[0]!)).toBeChecked();
	await expect(toggle(files[0]!)).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle(files[1]!)).toHaveAttribute('aria-expanded', 'true');

	// Unticking opens it back up.
	await reviewed(files[0]!).uncheck();
	await expect(toggle(files[0]!)).toHaveAttribute('aria-expanded', 'true');

	expect(pageErrors).toEqual([]);
});
