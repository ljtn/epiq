import {expect, test} from './fixtures.js';

// Passed as source strings, not closures: the root tsconfig has no DOM lib, and
// pulling one in for a test would let Node code reach for browser globals.
//
// Every repaint clears the canvas before redrawing, and every dot is an arc, so
// these two count repaints and drawn dots without the component reporting them.
const WATCH_CANVAS = `
	window.__paints = 0;
	window.__dots = 0;
	const proto = CanvasRenderingContext2D.prototype;
	const clearRect = proto.clearRect;
	const arc = proto.arc;
	proto.clearRect = function (...args) {
		window.__paints += 1;
		return clearRect.apply(this, args);
	};
	proto.arc = function (...args) {
		window.__dots += 1;
		return arc.apply(this, args);
	};
`;

const READ_DOTS = 'window.__dots';
const READ_PAINTS = 'window.__paints';
const RESET_PAINTS = 'window.__paints = 0';

// Hovering only reads the chart — it moves a highlight and opens a hint. The
// dots are unchanged, so redrawing them is pure waste, and at a window's worth
// of events it is enough waste to make the track stutter under the pointer.
test('hovering the scatter never repaints it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.addInitScript(WATCH_CANVAS);
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByRole('button', {name: 'Events', exact: true}).click();

	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toHaveAttribute('data-entrance', 'done');

	// Measuring repaints proves nothing on an empty canvas, so the dots have to
	// be on it before the sweep starts.
	await expect
		.poll(async () => page.evaluate<number>(READ_DOTS), {timeout: 20_000})
		.toBeGreaterThan(0);

	// The entrance and any history reply still in flight both repaint, and one
	// landing mid-sweep would be counted against the hover. Wait for quiet.
	await expect
		.poll(
			async () => {
				const before = await page.evaluate<number>(READ_PAINTS);
				await page.waitForTimeout(400);

				return (await page.evaluate<number>(READ_PAINTS)) - before;
			},
			{timeout: 20_000},
		)
		.toBe(0);

	const box = await canvas.boundingBox();
	if (!box) throw new Error('scatter canvas is not on screen');

	await page.evaluate(RESET_PAINTS);

	const y = box.y + box.height / 2;
	for (let step = 0; step <= 20; step += 1) {
		await page.mouse.move(box.x + (box.width * step) / 20, y);
	}

	// Deliberately exact: a hover that repaints even once is the memo missing.
	expect(await page.evaluate<number>(READ_PAINTS)).toBe(0);
	expect(pageErrors).toEqual([]);
});
