import {expect, test} from './fixtures.js';

test.setTimeout(120_000);

test('hovering a Log row singles that event out in the scatter', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Highlight ${Date.now()}`;
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
	const ticketUrl = page.url();

	// Reopened so the fetched window covers the event just made — a dot only
	// exists for what the timeline returned.
	await page.goto(ticketUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The scatter only exists in the events layout; volume mode draws bars.
	await page.getByTitle(/^Events —/).click();
	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toBeVisible();
	await expect(canvas).toHaveAttribute('data-highlight', '');

	await page.getByRole('button', {name: /^Log/}).click();
	await page.getByTestId('issue-history-row').first().hover();

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
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
	const ticketUrl = page.url();

	await page.goto(ticketUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByTitle(/^Events —/).click();

	const canvas = page.getByTestId('scatter-canvas');
	await expect(canvas).toBeVisible();

	await page.getByRole('button', {name: /^Log/}).click();
	const row = page.getByTestId('issue-history-row').first();
	await row.hover();
	await expect(canvas).not.toHaveAttribute('data-highlight', '');

	// Narrowing the series to Tags drops the ticket-creation dot from the chart
	// while the Log row still points at that event.
	await page.getByText('All board events').click();
	await page.getByRole('radio', {name: 'Tags'}).click();
	await page.waitForTimeout(800);

	await row.hover();
	// Nothing to light, so nothing should be dimmed either.
	await expect(canvas).toHaveAttribute('data-highlight', '');
});
