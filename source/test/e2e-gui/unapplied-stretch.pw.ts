// The stretch the board has not applied, and the case that is easy to lose:
// zoom past the checkout and the needle leaves the window while every bar on
// screen is still after it.

import {expect, test} from './fixtures.js';
import {trackWithWindow} from './track.js';
import {returnToLive} from './live-board.js';

test('the unapplied stretch survives the needle leaving the window', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const track = await trackWithWindow(page);
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	// Park the board a third of the way along, so there is window either side.
	await page.mouse.click(box.x + box.width * 0.35, box.y + box.height / 2);

	const veil = page.getByTestId('scrubber-unapplied');
	await expect(veil).toBeVisible();

	// With the needle in view the stretch starts at it, not at the window's edge.
	await expect
		.poll(async () => (await veil.boundingBox())?.x ?? 0)
		.toBeGreaterThan(box.x + 1);

	// Now drag out a window that begins after the checkout, which takes the
	// needle off the chart entirely.
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, {
		steps: 8,
	});
	await page.mouse.up();

	// Everything in view is after the checkout, so the whole window is veiled —
	// and it starts at the left edge rather than at a needle that is not there.
	await expect(veil).toBeVisible();
	await expect
		.poll(async () => (await veil.boundingBox())?.x ?? Infinity)
		.toBeLessThanOrEqual(box.x + 1);

	await returnToLive(page);
	await expect(veil).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
