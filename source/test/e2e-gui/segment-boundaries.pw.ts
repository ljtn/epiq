// The track's grain is drawn all the time: a hairline at every segment
// boundary, not only the highlight under the pointer.

import {expect, test} from './fixtures.js';
import {trackWithWindow} from './track.js';

test('the window is cut into segments the reader can see without hovering', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// A week is cut into days: six boundaries, at least, inside the window.
	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await expect
		.poll(async () => await page.getByTestId('segment-boundary').count())
		.toBeGreaterThanOrEqual(6);

	const track = await trackWithWindow(page);
	const box = (await track.boundingBox())!;
	const line = (await page
		.getByTestId('segment-boundary')
		.first()
		.boundingBox())!;

	// Hairlines, spanning the track, inside it.
	expect(line.width).toBeLessThanOrEqual(1);
	expect(line.x).toBeGreaterThan(box.x);
	expect(line.x).toBeLessThan(box.x + box.width);
	expect(line.height).toBeGreaterThanOrEqual(box.height - 1);

	await page.getByRole('button', {name: 'All', exact: true}).click();
	expect(pageErrors).toEqual([]);
});
