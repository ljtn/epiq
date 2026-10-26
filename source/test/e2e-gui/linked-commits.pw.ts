// The Code series narrowed to linked commits, on screen tickets only. Read via
// the log, which draws by the chart's rule.

import {expect, test} from './fixtures.js';
import {addTicketForRef} from './ticket.js';
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
	await page.getByPlaceholder('ticket name').fill(`Linked ${stamp}`);
	await page.getByPlaceholder('ticket name').press('Enter');
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

	// The opening state, which nobody has chosen: the whole repository, so a
	// board with nothing linked to it yet still has its history beside it.
	const lines = page.getByTestId('log-line');
	const select = page.getByTestId('commit-select');
	await expect(select).toHaveText('Commits (all)');
	await expect(lines.filter({hasText: linked})).toHaveCount(1);
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

// An empty window keeps the track's baseline, so the scrubber's height holds.
test('the Code track stays up, baseline and all, when the window has no commits to plot', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = await trackWithWindow(page);
	// The opening state is the wide one, so the narrowing is what this walks:
	// the row must be the same height either way.
	const wide = (await track.boundingBox())!.height;

	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toHaveText(
		'Commits (linked)',
	);

	expect((await track.boundingBox())!.height).toBe(wide);

	await page.getByTestId('commit-select').click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toHaveText('Commits (all)');

	expect((await track.boundingBox())!.height).toBe(wide);

	// Off is the one thing that takes the row away — for either series.
	await page.getByTestId('show-commits').click();
	await expect
		.poll(async () => (await track.boundingBox())!.height)
		.toBeLessThan(wide);
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

// A folded-away track's hit strip must not show a board hint.
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

// Which commits are drawn and what bars measure are chosen separately.
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
	const ref = await addTicketForRef(page, `Measured ${stamp}`);

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
	// Mostly additions, so the removal's share is sub-pixel without the floor.
	commitLinkedFile(
		repoRoot,
		ref!,
		`measured bulk ${stamp}`,
		`bulk-${stamp}.txt`,
		`${Array.from({length: 400}, (_, at) => `line ${at}`).join('\n')}\n`,
	);

	await page.goto(boardUrl);
	const select = page.getByTestId('commit-select');
	await expect(select).toHaveText('Commits (all)');

	// Counting commits, a bar is one block: the stacked pair is not drawn at all.
	await expect(page.getByTestId('line-bar')).toHaveCount(0);

	await select.click();
	await page.getByRole('radio', {name: 'Lines (+/-)'}).click();
	await expect(select).toHaveText('Lines (all)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// The narrowing moves without taking the measure with it.
	await select.click();
	await page.getByRole('radio', {name: 'Linked', exact: true}).click();
	await expect(select).toHaveText('Lines (linked)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// Both persist; wait for the bars, which arrive after the trigger.
	await page.reload();
	await expect(page.getByTestId('commit-select')).toHaveText('Lines (linked)');
	await expect
		.poll(async () => await page.getByTestId('line-bar').count())
		.toBeGreaterThan(0);

	// A mixed bucket draws both halves. Polled: the bars animate in.
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

// Bucket sizes four times apart, a day apart: however large the largest, every
// bar is a different height.
test('line bars keep their order however large the largest bucket is', async ({
	page,
	appUrl,
	pageErrors,
	repoRoot,
}) => {
	const DAY_MS = 24 * 60 * 60 * 1000;
	const stamp = Date.now();
	const first = stamp - 40 * DAY_MS;
	const sizes = [4, 16, 64, 256, 1024, 4096];

	sizes.forEach((size, at) =>
		commitPlainFile(
			repoRoot,
			`sized-${stamp}-${at}.txt`,
			`sized ${size} ${stamp}`,
			`${Array.from({length: size}, (_, line) => `line ${line}`).join('\n')}\n`,
			new Date(first + at * DAY_MS),
		),
	);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = new URL(page.url());
	boardUrl.search = '';
	const from = first - DAY_MS / 2;
	const to = first + (sizes.length - 0.5) * DAY_MS;
	await page.goto(`${boardUrl}?from=${from}&to=${to}`);

	const select = page.getByTestId('commit-select');
	await select.click();
	await page.getByRole('radio', {name: 'Lines (+/-)'}).click();
	await select.click();
	await page.getByRole('radio', {name: 'All', exact: true}).click();
	await expect(select).toHaveText('Lines (all)');

	// offsetHeight, not the bounding box: the bars grow in under a scaleY, and a
	// box measured mid-sweep differs bar to bar whatever the scale.
	const heights = `[...document.querySelectorAll('[data-testid="line-bar"]')].map(bar => bar.offsetHeight)`;
	await expect
		.poll(async () => {
			const drawn = (await page.evaluate(heights)) as number[];

			return (
				drawn.length === sizes.length && new Set(drawn).size === sizes.length
			);
		})
		.toBe(true);

	expect(pageErrors).toEqual([]);
});
