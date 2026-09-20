import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';
import {commitLinkedFile, linkedFileName} from './linked-commit.js';

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
	await page.reload();
	await expect(
		page.getByTestId('aside-pane').getByRole('button', {name: /^Code \(1\)/}),
	).toBeVisible();

	await page
		.getByTestId('aside-pane')
		.getByRole('button', {name: /^Code/})
		.click();
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
