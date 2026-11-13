import {expect, test} from './fixtures.js';
import {addTicket} from './ticket.js';

test('the board switcher counts what the filter leaves on the board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const title = `Counted ${Date.now()}`;
	await addTicket(page, title);
	await addTicket(page, `Hidden ${Date.now()}`);
	await page.goto(boardUrl);

	const defaultOption = page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Default'});

	await page.getByTestId('board-switcher').click();
	await expect(defaultOption).toContainText(/\d+ tickets?/);
	await expect(defaultOption).not.toContainText(' of ');
	await page.keyboard.press('Escape');

	await page.getByPlaceholder('Ref or title').fill(title);
	await page.getByTestId('board-switcher').click();
	await expect(defaultOption).toContainText(/1 of \d+ tickets/);

	expect(pageErrors).toEqual([]);
});
