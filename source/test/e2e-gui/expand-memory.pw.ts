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
	const third = [`third-${ref}-a.txt`, `third-${ref}-b.txt`];
	commitLinkedFiles(repoRoot, ref, 'first change', {
		[first[0]!]: 'alpha\nbeta\n',
		[first[1]!]: 'gamma\ndelta\n',
	});
	commitLinkedFiles(repoRoot, ref, 'second change', {
		[second[0]!]: 'epsilon\nzeta\n',
		[second[1]!]: 'eta\ntheta\n',
	});
	commitLinkedFiles(repoRoot, ref, 'third change', {
		[third[0]!]: 'iota\nkappa\n',
		[third[1]!]: 'lambda\nmu\n',
	});

	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(page.locator('aside')).toContainText(`Expand ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();

	// Scoped to their own cards throughout: the list is newest first, and more
	// than one card carries a control by the same name once they are open.
	const card = (subject: string) =>
		page.getByTestId('commit-card').filter({hasText: subject});

	// Both open shut, as they always have.
	await page.getByRole('button', {name: 'first change'}).click();
	await page.getByRole('button', {name: 'second change'}).click();
	const firstFile = page.getByRole('button', {name: first[0]!});
	const secondFile = page.getByRole('button', {name: second[0]!});
	await expect(firstFile).toHaveAttribute('aria-expanded', 'false');
	await expect(secondFile).toHaveAttribute('aria-expanded', 'false');

	await card('second change').getByRole('button', {name: 'Expand all'}).click();
	await expect(secondFile).toHaveAttribute('aria-expanded', 'true');

	// The habit is for what you open next. A commit already sitting open was
	// left the way the reader left it, and does not unfold underneath them.
	await expect(firstFile).toHaveAttribute('aria-expanded', 'false');
	await expect(
		card('first change').getByRole('button', {name: 'Expand all'}),
	).toBeVisible();

	// The next one opened takes the hint without being asked.
	await page.getByRole('button', {name: 'third change'}).click();
	const thirdFile = page.getByRole('button', {name: third[0]!});
	await expect(thirdFile).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('button', {name: third[1]!})).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	// Already open, so its own control offers the other direction.
	await expect(
		card('third change').getByRole('button', {name: 'Collapse all'}),
	).toBeVisible();

	// Asking for the opposite is remembered just as readily, across a reload.
	await card('third change')
		.getByRole('button', {name: 'Collapse all'})
		.click();
	await expect(thirdFile).toHaveAttribute('aria-expanded', 'false');

	await page.reload();
	await expect(page.locator('aside')).toContainText(`Expand ${stamp}`);
	await page.getByRole('button', {name: /^Commits/}).click();
	await page.getByRole('button', {name: 'first change'}).click();

	// The card's own control, not the file's `aria-expanded`: unfolding lands
	// in an effect, a frame after the collapsed one is painted, so a shut file
	// is what this would see either way. The button reads off the settled
	// state, so "Expand all" is only there while they really are all shut.
	await expect(
		card('first change').getByRole('button', {name: 'Expand all'}),
	).toBeVisible();
	await expect(page.getByRole('button', {name: first[0]!})).toHaveAttribute(
		'aria-expanded',
		'false',
	);

	expect(pageErrors).toEqual([]);
});
