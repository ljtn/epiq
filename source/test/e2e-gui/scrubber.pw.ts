import {expect, test} from './fixtures.js';

const SCOPES = ['Week', 'Month', 'Year', 'All'];

// Passed as source strings, not closures: the root tsconfig has no DOM lib, and
// pulling one in for a test would let Node code reach for browser globals.
const WATCH_BAR_STARTS = `
	window.__starts = 0;
	document.addEventListener('animationstart', event => {
		if (event.animationName === 'epiqScrubberGrow') window.__starts += 1;
	}, true);
`;

const RESET_STARTS = 'window.__starts = 0';

const SAMPLE = `({
	starts: window.__starts,
	bars: document.querySelectorAll('div[style*="epiqScrubberGrow"]').length,
})`;

// An entrance keyed to the click rather than to the arriving window runs once
// against the previous scope's data and again when the new data lands, so the
// starts outnumber the bars drawn.
test('a scope change animates each bar exactly once', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.waitForTimeout(1500);

	await page.evaluate(WATCH_BAR_STARTS);

	for (const scope of SCOPES) {
		await page.evaluate(RESET_STARTS);
		await page.getByRole('button', {name: scope, exact: true}).click();

		// Counted while the entrance is still running: a bar drops its animation
		// once the sweep is over, so it is only identifiable during it.
		await page.waitForTimeout(400);
		const {bars} = await page.evaluate<{bars: number}>(SAMPLE);

		// Past the entrance (760ms) plus the round trip for the new window.
		await page.waitForTimeout(1500);
		const {starts} = await page.evaluate<{starts: number}>(SAMPLE);

		expect(
			bars,
			`${scope}: nothing drawn, so the count proves nothing`,
		).toBeGreaterThan(0);
		expect(starts, `${scope}: bars animated more than once`).toBe(bars);
	}

	expect(pageErrors).toEqual([]);
});

// The groups on the controls row are named, in the row's order, and the names
// hang in the panel's padding above their group rather than taking a line of
// their own.
test('each group on the controls row wears its name above it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('spotlight')).toBeVisible();

	const groups = page.locator('[data-group-label]');
	await expect(groups).toHaveCount(5);
	expect(
		await groups.evaluateAll(nodes =>
			nodes.map(
				node =>
					(node as unknown as {dataset: Record<string, string>}).dataset[
						'groupLabel'
					],
			),
		),
	).toEqual(['View', 'Scope', 'Narrow', 'Filter', 'Play']);

	for (const group of await groups.all()) {
		const box = await group.boundingBox();
		const label = await group.locator('> span').first().boundingBox();
		if (!box || !label) throw new Error('group or label not laid out');
		expect(label.y + label.height).toBeLessThanOrEqual(box.y);
	}

	expect(pageErrors).toEqual([]);
});
