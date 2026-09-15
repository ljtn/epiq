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

// An empty window keeps its baseline, the way the board track does: the
// series narrowed to commits the window has none of must not take the green
// row away, or the scrubber's height would come and go with the narrowing.
test('the Code track stays up, baseline and all, when the window has no commits to plot', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	const withEveryCommit = (await track.boundingBox())!.height;

	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'Linked to a ticket'}).click();
	await expect(page.getByTestId('commit-select')).toHaveText('Linked');

	expect((await track.boundingBox())!.height).toBe(withEveryCommit);

	// Off is the one thing that takes the row away — for either series.
	await page.getByTitle('Show commits').click();
	await expect
		.poll(async () => (await track.boundingBox())!.height)
		.toBeLessThan(withEveryCommit);
	const withoutCommits = (await track.boundingBox())!.height;

	await page.getByTitle('Show board events').click();
	await expect
		.poll(async () => (await track.boundingBox())!.height)
		.toBeLessThan(withoutCommits);

	await page.getByTitle('Show board events').click();
	await page.getByTitle('Show commits').click();
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All commits'}).click();

	expect(pageErrors).toEqual([]);
});

// The track folds away with its series off, but the hit strip above the
// charts is still the track's for the pointer: what it must not do is put up
// a count of board events for a series that is not drawn.
test('no board hint comes up over a board track folded away', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = page.getByTestId('scrubber-track');
	const box = (await track.boundingBox())!;
	const aboveTheCharts = {x: box.x + box.width * 0.5, y: box.y - 2};

	await page.mouse.move(aboveTheCharts.x, aboveTheCharts.y);
	await expect(page.getByTestId('board-hint')).toBeVisible();
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 200);

	await page.getByTitle('Show board events').click();
	const folded = (await track.boundingBox())!;
	await page.mouse.move(folded.x + folded.width * 0.5, folded.y - 2);
	await page.waitForTimeout(300);
	await expect(page.getByTestId('board-hint')).toHaveCount(0);

	await page.getByTitle('Show board events').click();
	expect(pageErrors).toEqual([]);
});
