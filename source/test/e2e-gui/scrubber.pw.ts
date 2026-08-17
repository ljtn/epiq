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

		await page.waitForTimeout(2000);
		const {starts} = await page.evaluate<{starts: number}>(SAMPLE);

		expect(
			bars,
			`${scope}: nothing drawn, so the count proves nothing`,
		).toBeGreaterThan(0);
		expect(starts, `${scope}: bars animated more than once`).toBe(bars);
	}

	expect(pageErrors).toEqual([]);
});
