import {expect, test} from './fixtures.js';

const WATCH = `
	window.__grow = 0;
	document.addEventListener('animationstart', e => {
		if (
			e.animationName === 'epiqScrubberGrow' ||
			e.animationName === 'epiqScrubberTwinkle'
		) {
			window.__grow += 1;
		}
	}, true);
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
	// Let the first window land, which is itself an entrance.
	await page.waitForTimeout(5000);

	await page.evaluate(WATCH);

	await page.evaluate(RESET);
	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await page.waitForTimeout(2500);
	const onScopeChange = await page.evaluate<number>(READ);

	await page.evaluate(RESET);
	await page.getByRole('button', {name: 'Events', exact: true}).click();
	await page.waitForTimeout(2500);
	const onLayoutChange = await page.evaluate<number>(READ);
	await page.getByRole('button', {name: 'Volume', exact: true}).click();
	await page.waitForTimeout(2000);

	// A mutation makes the server broadcast fresh state; no view option changed.
	await page.evaluate(RESET);
	await page.getByRole('button', {name: '+', exact: true}).first().click();
	await page.getByPlaceholder('issue name').fill(`E${Date.now()}`);
	await page.getByRole('button', {name: 'create', exact: true}).click();
	await page.waitForTimeout(4000);
	const onIncomingData = await page.evaluate<number>(READ);

	console.log(
		`[scope] ${onScopeChange}  [layout] ${onLayoutChange}  [data] ${onIncomingData}`,
	);

	expect(onScopeChange, 'a scope change should animate').toBeGreaterThan(0);
	expect(onLayoutChange, 'a layout change should animate').toBeGreaterThan(0);
	expect(onIncomingData, 'incoming data must not animate').toBe(0);

	expect(pageErrors).toEqual([]);
});
