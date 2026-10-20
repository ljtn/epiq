import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

test("the board's panel says how the board runs", async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('board-details-open').click();
	const panel = page.locator('aside');

	await expect(panel.getByText(/^Flow,/)).toBeVisible();
	for (const figure of ['Filed', 'Closed', 'Median lead time', 'Sent back']) {
		await expect(panel.getByText(figure, {exact: true})).toBeVisible();
	}
	await expect(panel.getByText('Time per lane', {exact: true})).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test('time per lane counts only the lanes ticked, the last left out to start', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// A closed ticket, so there is time to split.
	await addTicket(page, `Timed ${Date.now()}`);
	await page.getByRole('button', {name: 'close ticket'}).click();
	await expect(page.getByRole('button', {name: 'reopen ticket'})).toBeVisible();

	await page.getByTestId('board-details-open').click();
	const toggles = page.getByTestId('board-lane-time-toggle');
	await expect(toggles.first()).toBeVisible();

	const boxes = toggles.locator('input');
	const count = await boxes.count();
	const lanes = await page
		.getByTestId('swimlane-handle')
		.locator('strong')
		.allTextContents();

	// Ticked, except the board's last lane if it is listed.
	for (let index = 0; index < count; index++) {
		const name = (await toggles.nth(index).textContent()) ?? '';
		if (name === lanes.at(-1)) await expect(boxes.nth(index)).not.toBeChecked();
		else await expect(boxes.nth(index)).toBeChecked();
	}

	// Unticking one takes it out of the shares; ticking brings it back.
	await toggles.first().click();
	await expect(boxes.first()).not.toBeChecked();
	await toggles.first().click();
	await expect(boxes.first()).toBeChecked();

	// With nothing ticked the bar stays as a muted track, so nothing jumps.
	const rowTop = async () =>
		(await toggles.first().locator('xpath=../..').boundingBox())?.y;
	const before = await rowTop();
	for (let index = 0; index < count; index++) {
		if (await boxes.nth(index).isChecked()) await toggles.nth(index).click();
	}
	for (let index = 0; index < count; index++) {
		await expect(boxes.nth(index)).not.toBeChecked();
	}
	expect(await rowTop()).toBe(before);

	expect(pageErrors).toEqual([]);
});
