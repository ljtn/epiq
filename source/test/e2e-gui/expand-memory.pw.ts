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

// Reading two commits in a row is the common case, and asking for the same
// unfolding on the second one is the annoyance this remembers away.
test('a commit opens its files the way the last one was left', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	const stamp = Date.now();
	await addTicket(page, `Expand ${stamp}`);
	const ref = await refOf(page);

	// Two files apiece: the wholesale control only appears with more than one,
	// and it is the one that speaks for how the reader likes to read.
	const first = [`first-${ref}-a.txt`, `first-${ref}-b.txt`];
	const second = [`second-${ref}-a.txt`, `second-${ref}-b.txt`];
	commitLinkedFiles(repoRoot, ref, 'first change', {
		[first[0]!]: 'alpha\nbeta\n',
		[first[1]!]: 'gamma\ndelta\n',
	});
	commitLinkedFiles(repoRoot, ref, 'second change', {
		[second[0]!]: 'epsilon\nzeta\n',
		[second[1]!]: 'eta\ntheta\n',
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Expand ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();

	// The first commit opens shut, as it always has.
	await page.getByRole('button', {name: 'first change'}).click();
	const firstFile = page.getByRole('button', {name: first[0]!});
	await expect(firstFile).toHaveAttribute('aria-expanded', 'false');

	await page.getByRole('button', {name: 'Expand all'}).click();
	await expect(firstFile).toHaveAttribute('aria-expanded', 'true');

	// The second one takes the hint without being asked.
	await page.getByRole('button', {name: 'second change'}).click();
	const secondFile = page.getByRole('button', {name: second[0]!});
	await expect(secondFile).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('button', {name: second[1]!})).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	// Scoped to its own card: the list is newest first, and both commits are
	// open by now, so an unscoped button matches either one.
	const secondCard = page
		.getByTestId('commit-card')
		.filter({hasText: 'second change'});

	// Already open, so its own control offers the other direction.
	await expect(
		secondCard.getByRole('button', {name: 'Collapse all'}),
	).toBeVisible();

	// Asking for the opposite is remembered just as readily, across a reload.
	await secondCard.getByRole('button', {name: 'Collapse all'}).click();
	await expect(secondFile).toHaveAttribute('aria-expanded', 'false');

	await page.reload();
	await expect(page.locator('aside')).toContainText(`Expand ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: 'first change'}).click();
	await expect(page.getByRole('button', {name: first[0]!})).toHaveAttribute(
		'aria-expanded',
		'false',
	);

	expect(pageErrors).toEqual([]);
});
