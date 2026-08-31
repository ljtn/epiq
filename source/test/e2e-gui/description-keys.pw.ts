import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const openTicket = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Keys ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
};

const startEditing = async (page: Page) => {
	await page.getByRole('button', {name: 'edit'}).first().click();

	return page.getByRole('textbox').last();
};

// The editor closing is what says the edit was confirmed rather than typed
// into: the "edit" button is only rendered while it is shut.
const editorClosed = (page: Page) =>
	expect(page.getByRole('button', {name: 'edit'}).first()).toBeVisible();

// Deliberately a reload rather than reopening the editor. A save comes back as
// a state broadcast, and the effect that reacts to it closes any open editor —
// so reopening straight after saving is a race the loaded machine loses.
const survivesAReload = async (page: Page, ...lines: string[]) => {
	await page.reload();
	for (const line of lines) {
		await expect(page.locator('aside')).toContainText(line);
	}
};

test('Enter confirms a description edit', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);

	const box = await startEditing(page);
	await box.fill('one line');
	await box.press('Enter');

	await editorClosed(page);
	await survivesAReload(page, 'one line');

	expect(pageErrors).toEqual([]);
});

// The paragraph break has to go somewhere now that Enter is spent on
// confirming, and the descriptions on this board are mostly multi-paragraph.
test('Shift+Enter writes a newline instead of confirming', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl);

	const box = await startEditing(page);
	await box.fill('first');
	await box.press('Shift+Enter');
	await box.press('Shift+Enter');
	await box.pressSequentially('second');

	// Still open, and holding both paragraphs: nothing has been saved yet, so
	// this reads the editor's own value.
	await expect(box).toHaveValue('first\n\nsecond');

	await box.press('Enter');
	await editorClosed(page);
	await survivesAReload(page, 'first', 'second');

	expect(pageErrors).toEqual([]);
});

// The key the comment boxes take, kept so the two do not disagree for anyone
// who already had it in their fingers.
test('Cmd/Ctrl+Enter still confirms', async ({page, appUrl, pageErrors}) => {
	await openTicket(page, appUrl);

	const box = await startEditing(page);
	await box.fill('via the modifier');
	await box.press('ControlOrMeta+Enter');

	await editorClosed(page);
	await survivesAReload(page, 'via the modifier');

	expect(pageErrors).toEqual([]);
});

// Nothing is saved here, so there is no broadcast to race: reopening is safe
// and is the only way to see that the draft was dropped rather than kept.
test('Escape still abandons the edit', async ({page, appUrl, pageErrors}) => {
	await openTicket(page, appUrl);

	const box = await startEditing(page);
	await box.fill('thrown away');
	await box.press('Escape');
	await editorClosed(page);

	await expect(await startEditing(page)).toHaveValue('');

	expect(pageErrors).toEqual([]);
});
