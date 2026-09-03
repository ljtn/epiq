import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The strip is positioned outside the track's own box, so the track's bounding
// box still stops at the charts — anything above its top is the borrowed gap.
const aboveTheCharts = async (page: Page) => {
	const box = await page.getByTestId('scrubber-track').boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	return {box, y: box.y - 4};
};

// Aiming at the top of a tall bar is the natural way to pick a busy stretch,
// and it used to land just over it, on nothing at all.
test('a drag begun in the air above the bars still zooms', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const zoom = page.getByRole('button', {name: 'Zoom'});
	await expect(zoom).toHaveAttribute('aria-pressed', 'false');

	const {box, y} = await aboveTheCharts(page);

	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, {steps: 10});
	await page.mouse.up();

	await expect(zoom).toHaveAttribute('aria-pressed', 'true');

	// The same stretch a drag across the bars themselves would have picked: the
	// strip is full width and measured off the track, so only the y differs.
	const params = new URLSearchParams(new URL(page.url()).search);
	expect(params.get('from')).not.toBeNull();
	expect(params.get('to')).not.toBeNull();

	expect(pageErrors).toEqual([]);
});

// Borrowed, not taken from somewhere that was doing a job: the strip is exactly
// the gap, so the controls above it keep every pixel they had.
test('the borrowed strip does not swallow the controls above it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const week = page.getByRole('button', {name: 'Week', exact: true});
	const before = await week.boundingBox();
	if (!before) throw new Error('the scope row is not on screen');

	// Its own bottom edge is the last row the strip must not reach.
	await page.mouse.click(
		before.x + before.width / 2,
		before.y + before.height - 1,
	);
	await expect(week).toHaveAttribute('aria-pressed', 'true');

	// And the row has not moved: the space came from the blank gap, not from
	// the buttons.
	expect(await week.boundingBox()).toEqual(before);

	expect(pageErrors).toEqual([]);
});
