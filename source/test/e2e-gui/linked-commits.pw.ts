// The Code series' select, down to linked commits: only commits whose subject
// leads with a ticket's ref, and only the tickets on screen while the board is
// narrowed.
// The log draws by the chart's rule, so it is what the test reads.

import {expect, test} from './fixtures.js';
import {trackWithWindow} from './track.js';
import {
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
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Linked ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Linked ${stamp}`);

	const ref = (
		await page.locator('aside').getByTestId('copy-ref').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	const linked = `linked work ${stamp}`;
	const plain = `plain housekeeping ${stamp}`;
	commitLinkedFile(repoRoot, ref!, linked, linkedFileName(ref!));
	commitPlainFile(repoRoot, `plain-${stamp}.txt`, plain);

	await page.goto(boardUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByTestId('log-toggle').click();

	// The opening state, which nobody has chosen: linked commits only, so the
	// housekeeping commit is not listed until somebody asks for the repository.
	const lines = page.getByTestId('log-line');
	const select = page.getByTestId('commit-select');
	await expect(select).toHaveText('Commits (linked)');
	await expect(lines.filter({hasText: linked})).toHaveCount(1);
	await expect(lines.filter({hasText: plain})).toHaveCount(0);

	await select.click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(select).toHaveText('Commits (all)');
	await expect(lines.filter({hasText: plain})).toHaveCount(1);

	await select.click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();
	await expect(select).toHaveText('Commits (linked)');

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
	await expect(page.getByTestId('commit-select')).toHaveText(
		'Commits (linked)',
	);
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toHaveText('Commits (all)');
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

	const track = await trackWithWindow(page);
	// The opening state is the narrow one, so the widening is what this walks:
	// the row must be the same height either way.
	const narrowed = (await track.boundingBox())!.height;

	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toHaveText('Commits (all)');

	expect((await track.boundingBox())!.height).toBe(narrowed);

	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toHaveText(
		'Commits (linked)',
	);

	expect((await track.boundingBox())!.height).toBe(narrowed);

	// Off is the one thing that takes the row away — for either series.
	await page.getByTestId('show-commits').click();
	await expect
		.poll(async () => (await track.boundingBox())!.height)
		.toBeLessThan(narrowed);
	const withoutCommits = (await track.boundingBox())!.height;

	await page.getByTestId('show-board-events').click();
	await expect
		.poll(async () => (await track.boundingBox())!.height)
		.toBeLessThan(withoutCommits);

	await page.getByTestId('show-board-events').click();
	await page.getByTestId('show-commits').click();
	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();

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

	const track = await trackWithWindow(page);
	const box = (await track.boundingBox())!;
	const aboveTheCharts = {x: box.x + box.width * 0.5, y: box.y - 2};

	await page.mouse.move(aboveTheCharts.x, aboveTheCharts.y);
	await expect(page.getByTestId('board-hint')).toBeVisible();
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 200);

	await page.getByTestId('show-board-events').click();
	const folded = (await track.boundingBox())!;
	await page.mouse.move(folded.x + folded.width * 0.5, folded.y - 2);
	await page.waitForTimeout(300);
	await expect(page.getByTestId('board-hint')).toHaveCount(0);

	await page.getByTestId('show-board-events').click();
	expect(pageErrors).toEqual([]);
});

// Which commits are drawn and what their bars measure are two questions. The
// list asks them in two groups, and answering one leaves the other alone —
// flattened into one row of options, "the deletions among linked commits"
// could not be asked for at all.
test('the measure and the narrowing are chosen apart, and both are remembered', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Measured ${stamp}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(`Measured ${stamp}`);

	const ref = (
		await page.locator('aside button[title^="Copy "]').first().textContent()
	)?.trim();
	expect(ref).toBeTruthy();

	// The second commit rewrites the first, so its bucket both adds and removes
	// and the bar drawn for it has two parts rather than one.
	commitLinkedFile(
		repoRoot,
		ref!,
		`measured work ${stamp}`,
		linkedFileName(ref!),
		'alpha\nbeta\ngamma\n',
	);
	commitLinkedFile(
		repoRoot,
		ref!,
		`measured rewrite ${stamp}`,
		linkedFileName(ref!),
		'alpha\ndelta\n',
	);
	// And a great deal more added than removed, so the removal's share of the
	// bucket is a fraction of a pixel. That is the case the floor under each
	// half exists for: without it this bucket draws as one solid colour and the
	// removal is off the chart entirely.
	commitLinkedFile(
		repoRoot,
		ref!,
		`measured bulk ${stamp}`,
		`bulk-${stamp}.txt`,
		`${Array.from({length: 400}, (_, at) => `line ${at}`).join('\n')}\n`,
	);

	await page.goto(boardUrl);
	const select = page.getByTestId('commit-select');
	await expect(select).toHaveText('Commits (linked)');

	// Counting commits, a bar is one block: the stacked pair is not drawn at all.
	await expect(page.getByTestId('line-bar')).toHaveCount(0);

	await select.click();
	await page.getByRole('radio', {name: 'Lines (+/-)'}).click();
	await expect(select).toHaveText('Lines (linked)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// The narrowing moves without taking the measure with it.
	await select.click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(select).toHaveText('Lines (all)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// Both outlive the page, like the series boxes beside them. The trigger is
	// drawn from the stored choice before the window it plots has arrived, so
	// the bars are waited for rather than read off the next line.
	await page.reload();
	await expect(page.getByTestId('commit-select')).toHaveText('Lines (all)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// A bucket that both added and removed draws both halves rather than one
	// colour: neither share is rounded away on a bar a few pixels tall.
	//
	// Polled rather than read once: the bars grow into place from nothing, and a
	// box measured during that sweep is the animation's, not the drawing's.
	const mixedBars = `[...document.querySelectorAll('[data-testid="line-bar"]')].map(bar => ({share: Number(bar.getAttribute('data-share')), added: bar.children[0].getBoundingClientRect().height, removed: bar.children[1].getBoundingClientRect().height})).filter(bar => bar.share > 0 && bar.share < 1)`;

	await expect
		.poll(async () => {
			const bars = (await page.evaluate(mixedBars)) as {
				added: number;
				removed: number;
			}[];

			return (
				bars.length > 0 && bars.every(bar => bar.added > 0 && bar.removed > 0)
			);
		})
		.toBe(true);

	expect(pageErrors).toEqual([]);
});
