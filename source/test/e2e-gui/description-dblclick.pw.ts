import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const openTicketWithDescription = async (
	page: Page,
	appUrl: string,
	description: string,
) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Dblclick ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);

	await page.getByRole('button', {name: 'edit'}).first().click();
	const box = page.getByRole('textbox').last();
	await box.fill(description);
	await box.press('ControlOrMeta+Enter');

	await expect(page.getByTestId('description-box')).toBeVisible();
};

// The "edit" button only renders while the editor is shut, so its absence is
// what says the editor opened.
const editorOpen = (page: Page) =>
	expect(page.getByRole('button', {name: 'edit'}).first()).toBeHidden();

const editorClosed = (page: Page) =>
	expect(page.getByRole('button', {name: 'edit'}).first()).toBeVisible();

test('double-clicking a description opens the editor', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicketWithDescription(page, appUrl, 'edit me by hand');

	await page.getByTestId('description-box').dblclick();

	await editorOpen(page);
	await expect(page.getByRole('textbox').last()).toHaveValue('edit me by hand');

	expect(pageErrors).toEqual([]);
});

// A description carries controls of its own — a link, an image, the show more
// this clamp added. A double-click that landed on one was aimed at it.
test('double-clicking show more expands without opening the editor', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const long = Array.from({length: 60}, (_, index) => `line ${index}`).join(
		'\n\n',
	);
	await openTicketWithDescription(page, appUrl, long);

	const showMore = page
		.getByTestId('description-box')
		.getByTestId('description-show-more');
	await showMore.dblclick();

	await editorClosed(page);
	// Expanded once and left there: the first click moved the toggle down the
	// page, so the second landed on the text that grew into its place rather
	// than collapsing the body again.
	await expect(showMore).toHaveText('show less');

	expect(pageErrors).toEqual([]);
});
