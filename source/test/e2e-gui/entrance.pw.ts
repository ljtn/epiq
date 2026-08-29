import {expect, test} from './fixtures.js';

// The bars animate through CSS; the scatter is drawn to a canvas and marks its
// own entrance with a data attribute instead. Both count as an entrance.
const WATCH = `
	window.__grow = 0;
	document.addEventListener('animationstart', e => {
		if (e.animationName === 'epiqScrubberGrow') window.__grow += 1;
	}, true);
	new MutationObserver(records => {
		for (const record of records) {
			if (
				record.attributeName === 'data-entrance' &&
				record.target.getAttribute('data-entrance') === 'playing'
			) {
				window.__grow += 1;
			}
		}
	}).observe(document.body, {
		subtree: true,
		attributes: true,
		attributeFilter: ['data-entrance'],
	});
`;

const RESET = 'window.__grow = 0';
const READ = 'window.__grow';

test.setTimeout(180_000);

// The entrance marks a view the user asked for. Data arriving on its own must
// update the bars in place.
test('the entrance plays for view changes, not for incoming data', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	// Let the first window land, which is itself an entrance. The windows
	// below are the entrance (BAR_ENTRANCE_TOTAL_MS, 760ms) plus a server
	// round trip.
	await page.waitForTimeout(1500);

	await page.evaluate(WATCH);

	await page.evaluate(RESET);
	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await page.waitForTimeout(1500);
	const onScopeChange = await page.evaluate<number>(READ);

	await page.evaluate(RESET);
	await page.getByRole('button', {name: 'Events', exact: true}).click();
	await page.waitForTimeout(1500);
	const onLayoutChange = await page.evaluate<number>(READ);
	await page.getByRole('button', {name: 'Volume', exact: true}).click();
	await page.waitForTimeout(1500);

	// A mutation makes the server broadcast fresh state; no view option changed.
	await page.evaluate(RESET);
	await page.getByRole('button', {name: '+', exact: true}).first().click();
	const title = `E${Date.now()}`;
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByRole('button', {name: 'create', exact: true}).click();
	// The state carrying the ticket has landed once its title shows; the window
	// after that is where an entrance would play if data alone triggered one.
	await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
	await page.waitForTimeout(1500);
	const onIncomingData = await page.evaluate<number>(READ);

	console.log(
		`[scope] ${onScopeChange}  [layout] ${onLayoutChange}  [data] ${onIncomingData}`,
	);

	expect(onScopeChange, 'a scope change should animate').toBeGreaterThan(0);
	expect(onLayoutChange, 'a layout change should animate').toBeGreaterThan(0);
	expect(onIncomingData, 'incoming data must not animate').toBe(0);

	expect(pageErrors).toEqual([]);
});
