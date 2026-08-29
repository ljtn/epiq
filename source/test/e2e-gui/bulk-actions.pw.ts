import {expect, test} from './fixtures.js';

const pick = (title: string) => `
(() => {
	const card = [...document.querySelectorAll('div[draggable="true"]')]
		.find(c => c.textContent.includes(${JSON.stringify(title)}));
	card.dispatchEvent(new MouseEvent('click', {bubbles: true, metaKey: true}));
	return true;
})()
`;

const actionButtons = `
[...document.querySelectorAll('aside button')]
	.map(b => b.textContent.trim())
	.filter(t => t.startsWith('close ') || t.startsWith('reopen '))
`;

test.setTimeout(180_000);

test('bulk actions only offer what applies to the selection', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const stamp = `A${Math.floor(Math.random() * 1e6)}`;
	const titles = [`${stamp}-one`, `${stamp}-two`];

	for (const title of titles) {
		await page.getByTitle('Add issue').first().click();
		await page.getByPlaceholder('issue name').fill(title);
		await page.getByPlaceholder('issue name').press('Enter');
		await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
		await page.goto(boardUrl);
		await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
	}

	await page.evaluate(pick(titles[0]!));
	await page.evaluate(pick(titles[1]!));
	await expect(page.locator('aside')).toContainText('2 tickets selected');

	// Nothing picked is closed, so reopen has nothing to act on.
	expect(await page.evaluate<string[]>(actionButtons)).toEqual([
		'close 2 tickets',
	]);

	// Closing takes them to the Closed board, where the pair is all closed and
	// the offer is the other way round.
	await page.getByRole('button', {name: 'close 2 tickets'}).click();
	// Two mutations and their broadcasts; under a full gate that outlasts the
	// default expectation.
	await expect(
		page.locator('div[draggable="true"]').filter({hasText: titles[0]!}),
	).toHaveCount(0, {timeout: 30_000});

	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Closed'})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText('Closed');
	await expect(page.getByText(titles[0]!, {exact: true}).first()).toBeVisible();

	await page.evaluate(pick(titles[0]!));
	await page.evaluate(pick(titles[1]!));
	await expect(page.locator('aside')).toContainText('2 tickets selected');

	expect(await page.evaluate<string[]>(actionButtons)).toEqual([
		'reopen 2 tickets',
	]);

	expect(pageErrors).toEqual([]);
});
