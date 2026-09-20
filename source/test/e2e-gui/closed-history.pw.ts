import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

// An event's board is where the ticket lived when it happened. Closing moves
// the ticket to the global Closed board — it must not take its past with it.
test('a closed ticket keeps its events in the log of the board they happened on', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Closed history ${Date.now()}`;
	await addTicket(page, title);

	await page.getByTestId('log-toggle').click();
	const log = page.getByTestId('event-log');
	await expect(log).toBeVisible();

	const line = log.getByTestId('log-line').filter({hasText: title});
	await expect(line).toHaveCount(1);

	// Close it from the palette.
	await page.keyboard.press('Control+k');
	await expect(page.getByTestId('command-palette')).toBeVisible();
	await page.keyboard.type('close ticket');
	const row = page.getByTestId('command-palette').getByRole('option').first();
	await expect(row).toContainText('Close ticket');
	await expect(row).not.toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('command-palette')).toBeHidden();

	await expect(
		page.locator('div[draggable="true"]').filter({hasText: title}),
	).toHaveCount(0, {timeout: 30_000});

	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The filing happened on this board. It still did.
	await expect(line).toHaveCount(1);

	// And after a reload, where the client rebuilds from a state in which the
	// ticket belongs to the Closed board.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('event-log')).toBeVisible();
	await expect(
		page
			.getByTestId('event-log')
			.getByTestId('log-line')
			.filter({hasText: title}),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});
