import {expect, test} from './fixtures.js';

// The label sits at the end of the controls row, directly above the end of the
// track, so it reads as naming that end. Over a window that does not run up to
// the present it would be naming it wrongly.
test('the "Now" label is absent over a window that does not reach the present', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const label = page.getByRole('button', {name: 'Now', exact: true});
	await expect(label).toBeVisible();
	const slot = await label.boundingBox();

	// Paged back a whole period, so the window now ends where the one before it
	// began — not at the present.
	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await expect(label).toBeVisible();
	await page.getByTitle('Earlier').click();
	await expect(label).toHaveCount(0);

	// Forward again, onto a window that does reach the present. The slot comes
	// back exactly where it was, so losing the word never moved the row.
	await page.getByTitle('Later').click();
	await expect(label).toBeVisible();
	expect(await label.boundingBox()).toEqual(slot);

	// The other way to a past window: drag one out on the chart.
	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, {steps: 10});
	await page.mouse.up();

	await expect(page.getByRole('button', {name: 'Zoom'})).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(label).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
