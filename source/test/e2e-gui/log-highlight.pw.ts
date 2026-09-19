import {expect, test} from './fixtures.js';

test.setTimeout(120_000);

test('hovering an event log row singles that event out in the scatter', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Highlight ${Date.now()}`;
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
	const ticketUrl = page.url();

	// Reopened so the fetched window covers the event just made — a dot only
	// exists for what the timeline returned.
	await page.goto(ticketUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The scatter only exists in the events layout; volume mode draws bars.
	await page.getByRole('button', {name: 'Events', exact: true}).click();
	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute('data-highlight', '');

	await page.getByTestId('log-toggle').click();
	await page.getByTestId('log-line').filter({hasText: title}).hover();

	// An event id, so the dot being lit is addressed by identity rather than by
	// a timestamp two events could share.
	await expect(canvas).not.toHaveAttribute('data-highlight', '');

	await page.getByTestId('board-switcher').hover();
	await expect(canvas).toHaveAttribute('data-highlight', '');

	expect(pageErrors).toEqual([]);
});

test('an event with no dot on the chart leaves the scatter alone', async ({
	page,
	appUrl,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Filtered out ${Date.now()}`;
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
	const ticketUrl = page.url();

	await page.goto(ticketUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByRole('button', {name: 'Events', exact: true}).click();

	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toBeVisible();

	await page.getByTestId('log-toggle').click();
	const row = page.getByTestId('log-line').filter({hasText: title});
	await row.hover();
	await expect(canvas).not.toHaveAttribute('data-highlight', '');

	// Tags on its own is the whole filter, so the chart draws tags and nothing
	// else — the ticket-creation dot goes, and so does its row, since the log
	// draws by the chart's own rule. Nothing left to point at, so nothing is
	// lit and nothing is dimmed.
	await page.getByRole('button', {name: 'Board', exact: true}).click();
	await page.getByRole('checkbox', {name: 'Tags'}).click();
	await page.waitForTimeout(800);

	await expect(row).toHaveCount(0);
	await expect(canvas).toHaveAttribute('data-highlight', '');
});
