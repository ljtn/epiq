import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The lane the icon would be drawn on: an empty column offers no stats, so
// asserting on the first header would pass whether the feature works or not.
const laneWithTickets = async (page: Page): Promise<Locator> => {
	const headers = page.getByTestId('swimlane-handle');

	for (let index = 0; index < (await headers.count()); index++) {
		const header = headers.nth(index);
		const count = Number(
			(await header.textContent())?.match(/\((\d+)\)/)?.[1] ?? 0,
		);

		if (count > 0) return header;
	}

	throw new Error('no swimlane on the board holds a ticket');
};

// The suite shares one server, and a board left parked in the past never
// finishes loading for the next test.
const returnToLive = async (page: Page) => {
	const resume = page.getByRole('button', {name: 'Resume', exact: true});

	if ((await resume.count()) > 0 && (await resume.isEnabled())) {
		await resume.click();
		await expect(resume).toHaveCount(0);
	}
};

test('a lane opens its own stats, and says how long its tickets have sat there', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Dwell ${Date.now()}`;
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');

	// The scan below reads each header once, so the ticket has to be on the
	// board before it runs. Scoped to the board: creating a ticket opens its
	// details, and the title is then on screen twice.
	await expect(page.getByRole('main').getByText(title)).toBeVisible();

	const lane = await laneWithTickets(page);
	await lane.getByTestId('swimlane-stats-open').click();

	const panel = page.getByTestId('swimlane-stats');
	await expect(panel).toBeVisible();

	// The lane's own figures, not another lane's: the panel names the column it
	// was opened from.
	await expect(panel).toContainText(
		(await lane.locator('strong').textContent()) ?? '',
	);

	await expect(page.getByText('median stay', {exact: true})).toBeVisible();
	await expect(page.getByText('Usually arrives from')).toBeVisible();
	await expect(page.getByText('Usually moves on to')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The ticket panel beside it deliberately survives a stray click, because it
// holds a half-written description; a lane's figures hold nothing.
test('a click on the board closes the lane panel', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const lane = await laneWithTickets(page);
	await lane.getByTestId('swimlane-stats-open').click();
	await expect(page.getByTestId('swimlane-stats')).toBeVisible();

	// The empty ground below the columns: a click that was never about a
	// ticket, a lane header, or the panel.
	await page.getByRole('main').click({position: {x: 40, y: 40}});

	await expect(page.getByTestId('swimlane-stats')).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// Every figure on the panel is measured against now, which says nothing about
// a board being drawn as it was at some other moment.
test('no lane offers stats while the board is scrubbed', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(
		(await laneWithTickets(page)).getByTestId('swimlane-stats-open'),
	).toBeVisible();

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	// Near the present, so the past being drawn still has tickets on it — the
	// assertion has to fail on an icon left behind, not on an empty board.
	await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toBeEnabled();

	await expect(
		(await laneWithTickets(page)).getByTestId('swimlane-stats-open'),
	).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});
