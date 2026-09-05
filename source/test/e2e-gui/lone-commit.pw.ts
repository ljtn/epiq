import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {
	COMMIT_CACHE_MS,
	commitLinkedFile,
	linkedFileName,
} from './linked-commit.js';

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

// With one commit there is nothing to choose between, so the tab opens it
// rather than waiting for the click that would.
test('a ticket with a single commit opens it unasked', async ({
	page,
	pageErrors,
	repoRoot,
}) => {
	await addTicket(page, `Lone ${Date.now()}`);
	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	commitLinkedFile(repoRoot, ref!, 'add notes');
	await page.waitForTimeout(COMMIT_CACHE_MS);
	await page.reload();
	await expect(
		page.getByRole('button', {name: /^Commits \(1\)/}),
	).toBeVisible();

	await page.getByRole('button', {name: /^Commits/}).click();
	const commit = page.getByRole('button', {name: 'add notes +3 -0'});
	await expect(commit).toHaveAttribute('aria-expanded', 'true');
	await expect(
		page.getByRole('button', {name: linkedFileName(ref!)}),
	).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('[data-line]')).toHaveCount(3);

	// Opened once: shutting it by hand sticks.
	await commit.click();
	await expect(commit).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('[data-line]')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
