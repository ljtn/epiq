import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The lane a figure would be drawn for: an empty column carries none, so
// asserting on the first header would pass whether the figure works or not.
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

test('a lane says how long its tickets have sat in it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Dwell ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	const dwell = (await laneWithTickets(page)).getByTestId('swimlane-dwell');

	await expect(dwell).toBeVisible();
	await expect(dwell).toHaveText(/med · .+ max/);

	expect(pageErrors).toEqual([]);
});

// Elapsed-until-now says nothing about a board being shown as it was at some
// other moment, so the figure goes away rather than answering the wrong
// question.
test('no lane carries a dwell while the board is scrubbed', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(
		(await laneWithTickets(page)).getByTestId('swimlane-dwell'),
	).toBeVisible();

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	// Near the present, so the past being drawn still has tickets on it — the
	// assertion has to fail on a figure left behind, not on an empty board.
	await page.mouse.click(box.x + box.width * 0.95, box.y + box.height / 2);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toBeEnabled();

	await expect(
		(await laneWithTickets(page)).getByTestId('swimlane-dwell'),
	).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});
