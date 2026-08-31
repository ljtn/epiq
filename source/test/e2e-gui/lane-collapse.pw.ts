import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The lanes only appear on a panel at least LANE_VIEW_WIDTH wide.
test.use({viewport: {width: 1600, height: 900}});

const openLanes = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Lanes ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	await page.getByRole('button', {name: 'Fullscreen'}).click();
	await expect(page.getByTestId('lane-commits')).toBeVisible();
};

const laneWidth = async (page: Page, name: string): Promise<number> =>
	(await page.getByTestId(`lane-${name}`).boundingBox())?.width ?? 0;

// Clicking the header used to collapse the lane wholesale, which was far too
// easy to do by aiming at nothing in particular.
test('only the button collapses a lane, not the header', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openLanes(page, appUrl);

	await page.getByTestId('lane-overview').getByText('Overview').click();
	await expect(page.getByTestId('lane-overview')).toHaveAttribute(
		'data-collapsed',
		'false',
	);

	await page.getByRole('button', {name: 'Collapse Overview'}).click();
	await expect(page.getByTestId('lane-overview')).toHaveAttribute(
		'data-collapsed',
		'true',
	);

	expect(pageErrors).toEqual([]);
});

// A track going from `minmax(0, 1fr)` to `28px` changes type, and CSS cannot
// interpolate across types — it snaps however the transition is written. The
// widths are computed in pixels precisely so the collapse can animate, and
// a single `fr` creeping back in would silently kill it.
test('the lane tracks are sized so the collapse can animate', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openLanes(page, appUrl);

	// A string body, like the other DOM reads in this suite: the tests compile
	// under the root tsconfig, which carries no DOM lib.
	const style = await page.evaluate<{columns: string; transition: string}>(`
		(() => {
			const lane = document.querySelector('[data-testid="lane-commits"]');
			const computed = getComputedStyle(lane.parentElement);
			return {
				columns: computed.gridTemplateColumns,
				transition: computed.transitionProperty,
			};
		})()
	`);

	expect(style.columns).not.toContain('fr');
	expect(style.transition).toContain('grid-template-columns');

	expect(pageErrors).toEqual([]);
});

// Four even-ish lanes leave the diff a quarter of the panel. Collapsing the
// ones you are not reading is what hands that width to the commits lane.
test('collapsing a lane gives its width to the ones still open', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openLanes(page, appUrl);

	const before = await laneWidth(page, 'commits');
	await expect(page.getByTestId('lane-overview')).toHaveAttribute(
		'data-collapsed',
		'false',
	);

	await page.getByRole('button', {name: 'Collapse Overview'}).click();
	await expect(page.getByTestId('lane-overview')).toHaveAttribute(
		'data-collapsed',
		'true',
	);

	await expect
		.poll(async () => (await laneWidth(page, 'commits')) > before)
		.toBe(true);

	// The rail is still the lane, and it says how to get back.
	await page.getByRole('button', {name: 'Expand Overview'}).click();
	await expect(page.getByTestId('lane-overview')).toHaveAttribute(
		'data-collapsed',
		'false',
	);

	expect(pageErrors).toEqual([]);
});

test('a collapsed lane stays collapsed across a reload', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openLanes(page, appUrl);

	await page.getByRole('button', {name: 'Collapse Comments'}).click();
	await expect(page.getByTestId('lane-comments')).toHaveAttribute(
		'data-collapsed',
		'true',
	);

	await page.reload();
	await page.getByRole('button', {name: 'Fullscreen'}).click();

	await expect(page.getByTestId('lane-comments')).toHaveAttribute(
		'data-collapsed',
		'true',
	);

	expect(pageErrors).toEqual([]);
});

// Collapsing the last one would leave four rails and nothing to read, so the
// final open lane stops offering the control at all.
test('the last open lane cannot be collapsed', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openLanes(page, appUrl);

	for (const name of ['Overview', 'Comments', 'Log']) {
		await page.getByRole('button', {name: `Collapse ${name}`}).click();
	}

	await expect(page.getByTestId('lane-commits')).toHaveAttribute(
		'data-collapsed',
		'false',
	);
	await expect(
		page.getByRole('button', {name: 'Collapse Commits'}),
	).toHaveCount(0);

	// Reopening any other lane hands the control back.
	await page.getByRole('button', {name: 'Expand Log'}).click();
	await expect(
		page.getByRole('button', {name: 'Collapse Commits'}),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});
