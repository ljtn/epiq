// Paging the window from the chart: arrows off its ends while it is hovered,
// and a horizontal wheel over it. The controls row carries no pager.

import {expect, test} from './fixtures.js';
import {openBoard} from './live-board.js';

const offsetParam = (url: string) => new URL(url).searchParams.get('offset');

test('the arrows appear with the pointer over the chart and page the window', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByRole('button', {name: 'Week', exact: true}).click();

	const track = page.getByTestId('scrubber-track');
	const earlier = page.getByTestId('page-earlier');
	const later = page.getByTestId('page-later');

	// At the present there is nothing later to page to, so only one arrow.
	await expect(earlier).toHaveCount(1);
	await expect(later).toHaveCount(0);

	// The row above holds no pager.
	await expect(page.getByTitle('Earlier')).toHaveCount(1);
	const header = page.getByTestId('scrubber-track').locator('..');
	await expect(header.getByText('Last 7 days')).toHaveCount(0);

	// Off the chart the arrow is there but not drawn. Evaluated as a string:
	// this file is type-checked against the Node libs, which have no DOM.
	const arrowOpacity = () =>
		page.evaluate(
			`getComputedStyle(document.querySelector('[data-testid="page-earlier"]').parentElement).opacity`,
		) as Promise<string>;

	await page.mouse.move(5, 5);
	await expect.poll(arrowOpacity).toBe('0');

	const box = (await track.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect.poll(arrowOpacity).toBe('1');

	// The click pages, and does not read as a press on the track behind it.
	const before = page.url();
	await earlier.click();
	await expect.poll(() => offsetParam(page.url())).toBe('1');
	expect(page.url()).not.toBe(before);

	// Paged back, the window is named on the chart, and there is a way later.
	await expect(page.getByTestId('scrubber-window-label')).toBeVisible();
	await expect(later).toHaveCount(1);
	await later.click();
	await expect.poll(() => offsetParam(page.url())).toBeNull();
	await expect(page.getByTestId('scrubber-window-label')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('a horizontal wheel over the chart pages it, one page per gesture', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByRole('button', {name: 'Week', exact: true}).click();

	const box = (await page.getByTestId('scrubber-track').boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

	// One swipe in a burst of small steps, the way a trackpad delivers it:
	// one page, not one per step.
	for (let step = 0; step < 8; step++) await page.mouse.wheel(-60, 0);
	await expect.poll(() => offsetParam(page.url())).toBe('1');
	await page.waitForTimeout(600);
	expect(offsetParam(page.url())).toBe('1');

	// The other way brings it back to the present.
	await page.mouse.wheel(300, 0);
	await expect.poll(() => offsetParam(page.url())).toBeNull();

	// A vertical scroll over the chart is not a page.
	await page.waitForTimeout(600);
	await page.mouse.wheel(0, 300);
	await page.waitForTimeout(300);
	expect(offsetParam(page.url())).toBeNull();

	expect(pageErrors).toEqual([]);
});
