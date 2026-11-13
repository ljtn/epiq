import {expect, test} from './fixtures.js';
import {switchToBoard} from './board-switcher.js';
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

test('switching board clears the filter and keeps the scope', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.goto(`${page.url().split('?')[0]}?scope=week&window=1`);
	await page.getByPlaceholder('Ref or title').fill('nothing matches this');
	await expect(page).toHaveURL(/window=1/);

	await switchToBoard(page, 'QA');

	await expect(page).not.toHaveURL(/window=1/);
	await expect(page).not.toHaveURL(/only=/);
	await expect(page).toHaveURL(/scope=week/);
	await expect(page.getByPlaceholder('Ref or title')).toHaveValue('');

	expect(pageErrors).toEqual([]);
});
