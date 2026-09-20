import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

const card = (page: Page, title: string) =>
	page.locator('[draggable="true"]').filter({hasText: title});

test('typing in the text filter narrows the board by title or ref, and Escape clears it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const apple = `Apple ${stamp}`;
	const banana = `Banana ${stamp}`;

	await addTicket(page, apple);
	await addTicket(page, banana);

	await page.goto(boardUrl);
	await expect(card(page, apple)).toBeVisible();
	await expect(card(page, banana)).toBeVisible();

	const bananaRef = (
		await card(page, banana).getByTestId('copy-ref').textContent()
	)?.trim();
	expect(bananaRef).toMatch(/^[A-Z0-9]{7}$/);

	const filter = page.getByTestId('text-filter');

	// By title, ignoring case.
	await filter.fill(`apple ${stamp}`);
	await expect(card(page, banana)).toHaveCount(0);
	await expect(card(page, apple)).toBeVisible();

	// By ref, ignoring case.
	await filter.fill(bananaRef!.toLowerCase());
	await expect(card(page, apple)).toHaveCount(0);
	await expect(card(page, banana)).toBeVisible();

	// Escape empties the box and brings everything back.
	await filter.press('Escape');
	await expect(filter).toHaveValue('');
	await expect(card(page, apple)).toBeVisible();
	await expect(card(page, banana)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The query is one more narrowing on the scrubber bar, so the picture above
// follows it as the columns do. The log is that picture's rule written out as
// rows, so it is what the test reads.
test('the text filter narrows the event log to the tickets it keeps', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = Date.now();
	const apple = `Apple ${stamp}`;
	const banana = `Banana ${stamp}`;

	await addTicket(page, apple);
	await addTicket(page, banana);

	await page.goto(boardUrl);
	await expect(card(page, banana)).toBeVisible();

	await page.getByTestId('log-toggle').click();
	const lines = page.getByTestId('log-line');
	await expect(lines.filter({hasText: apple})).toHaveCount(1);
	await expect(lines.filter({hasText: banana})).toHaveCount(1);

	const filter = page.getByTestId('text-filter');
	await filter.fill(`apple ${stamp}`);

	await expect(lines.filter({hasText: banana})).toHaveCount(0);
	await expect(lines.filter({hasText: apple})).toHaveCount(1);
	await expect(card(page, banana)).toHaveCount(0);

	await filter.press('Escape');
	await expect(lines.filter({hasText: banana})).toHaveCount(1);

	// Folding the charts away does not take the query with them: a narrowing
	// nobody can see would be a board missing its tickets. Put back afterwards,
	// since the fold is remembered.
	await page.getByTestId('timeline-toggle').click();
	await expect(page.getByTestId('scrubber-track')).toHaveCount(0);
	await expect(filter).toBeVisible();
	await page.getByTestId('timeline-toggle').click();
	await expect(page.getByTestId('scrubber-track')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
