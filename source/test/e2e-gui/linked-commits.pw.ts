// The Code series' select, down to linked commits: only commits whose subject
// leads with a ticket's ref, and only the tickets on screen while the board is
// narrowed.
// The log draws by the chart's rule, so it is what the test reads.

import {expect, test} from './fixtures.js';
import {
	COMMIT_CACHE_MS,
	commitLinkedFile,
	commitPlainFile,
	linkedFileName,
} from './linked-commit.js';

test('the Code series narrowed to linked commits keeps only commits linked to a ticket, and to the tickets on screen', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Linked ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Linked ${stamp}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	const linked = `linked work ${stamp}`;
	const plain = `plain housekeeping ${stamp}`;
	commitLinkedFile(repoRoot, ref!, linked, linkedFileName(ref!));
	commitPlainFile(repoRoot, `plain-${stamp}.txt`, plain);
	await page.waitForTimeout(COMMIT_CACHE_MS);

	await page.goto(boardUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByTestId('log-toggle').click();

	const lines = page.getByTestId('log-line');
	await expect(lines.filter({hasText: linked})).toHaveCount(1);
	await expect(lines.filter({hasText: plain})).toHaveCount(1);

	const select = page.getByTestId('commit-select');
	await expect(select).toHaveText('Code');
	await select.click();
	await page.getByRole('radio', {name: 'Linked to a ticket'}).click();
	await expect(select).toHaveText('Linked');

	await expect(lines.filter({hasText: plain})).toHaveCount(0);
	await expect(lines.filter({hasText: linked})).toHaveCount(1);

	// Narrowed to tickets the commit is not linked to, it goes too — the
	// picture plots what the columns show.
	const filter = page.getByTestId('text-filter');
	await filter.fill(`nothing matches ${stamp}`);
	await expect(lines.filter({hasText: linked})).toHaveCount(0);

	await filter.fill(`linked ${stamp}`);
	await expect(lines.filter({hasText: linked})).toHaveCount(1);
	await filter.press('Escape');

	// Remembered, like the series boxes beside it.
	await page.reload();
	await expect(page.getByTestId('commit-select')).toHaveText('Linked');
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All commits'}).click();
	await expect(page.getByTestId('commit-select')).toHaveText('Code');
	await expect(lines.filter({hasText: plain})).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});
