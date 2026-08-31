import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {COMMIT_CACHE_MS, commitLinkedFiles} from './linked-commit.js';
import {LARGE_DIFF_LINES} from '../../lib/utils/diff-size.js';

// Just past the limit, and no further: the seeded repo carries this commit for
// the rest of the worker's run, and the point is the threshold, not the size.
const lockfileContents = `${Array.from(
	{length: LARGE_DIFF_LINES + 1},
	(_, index) => `    "package-${index}": "1.0.0",`,
).join('\n')}\n`;

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

// The reported case: a commit that touches a lockfile alongside real code.
// Expand all is for reading the code, and a 4000-line lockfile rendered
// alongside it is what stalls the tab.
test('“Expand all” opens the ordinary files and leaves a lockfile shut', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	const stamp = Date.now();
	await addTicket(page, `Lockfile ${stamp}`);
	const ref = await refOf(page);

	const codeFile = `notes-${ref}.txt`;
	const lockFile = `lock-${ref}.json`;
	commitLinkedFiles(repoRoot, ref, 'bump deps', {
		[codeFile]: 'alpha\nbeta\ngamma\n',
		[lockFile]: lockfileContents,
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Lockfile ${stamp}`);

	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: 'bump deps'}).click();

	const code = page.getByRole('button', {name: codeFile});
	const lock = page.getByRole('button', {name: lockFile});
	await expect(code).toBeVisible();
	await expect(lock).toBeVisible();

	// Says why it is going to be passed over, before anything is clicked.
	await expect(lock.getByTestId('large-diff-badge')).toBeVisible();

	await page.getByRole('button', {name: 'Expand all'}).click();

	await expect(code).toHaveAttribute('aria-expanded', 'true');
	await expect(lock).toHaveAttribute('aria-expanded', 'false');

	// Still reachable by hand — collapsed is the default, not a refusal.
	await lock.click();
	await expect(lock).toHaveAttribute('aria-expanded', 'true');
	// Open, the badge has nothing left to explain.
	await expect(lock.getByTestId('large-diff-badge')).toHaveCount(0);

	// And the button can still shut everything, including the one it never
	// opened — otherwise a large file opened by hand would be stuck open.
	await page.getByRole('button', {name: 'Collapse all'}).click();
	await expect(code).toHaveAttribute('aria-expanded', 'false');
	await expect(lock).toHaveAttribute('aria-expanded', 'false');

	expect(pageErrors).toEqual([]);
});
