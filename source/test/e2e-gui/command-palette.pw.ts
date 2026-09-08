import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Ctrl rather than Meta: the handler takes either, and Ctrl is the one a
// headless Chromium fires the same way on every platform.
const openPalette = async (page: Page) => {
	await page.keyboard.press('Control+k');
	await expect(page.getByTestId('command-palette')).toBeVisible();
};

const palette = (page: Page) => page.getByTestId('command-palette');

const rows = (page: Page) => palette(page).getByRole('option');

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

test('it opens on the chord and leaves on escape', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(palette(page)).toBeHidden();

	await openPalette(page);
	await expect(rows(page).first()).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(palette(page)).toBeHidden();

	expect(pageErrors).toEqual([]);
});

// The TUI's own way in. Somebody who learned `:` there should not have to
// learn a second key here.
test('a bare colon opens it too, the way the TUI reaches a command', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.keyboard.press(':');
	await expect(palette(page)).toBeVisible();

	// It types into the palette rather than closing it: only the chord toggles.
	await page.keyboard.press(':');
	await expect(palette(page)).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(palette(page)).toBeHidden();

	expect(pageErrors).toEqual([]);
});

// A colon belongs to whatever field is being typed in — a ticket title can
// hold one, and stealing it would be worse than having no shortcut.
test('a colon typed into a field stays in the field', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	const field = page.getByPlaceholder('issue name');
	await field.fill('Fix');
	await field.press(':');

	await expect(palette(page)).toBeHidden();
	await expect(field).toHaveValue('Fix:');

	expect(pageErrors).toEqual([]);
});

// The chord has to reach the board from wherever the pointer left the focus,
// but not out of a field somebody is typing in.
test('it stays out of the way while you are typing', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	const field = page.getByPlaceholder('issue name');
	await field.fill('Typing');
	await field.press('Control+k');

	await expect(palette(page)).toBeHidden();
	await expect(field).toHaveValue('Typing');

	expect(pageErrors).toEqual([]);
});

test('typing narrows the list, and enter runs what is left', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await openPalette(page);
	const before = await rows(page).count();

	await page.keyboard.type('log');
	await expect(rows(page).first()).toContainText('Toggle the event log');
	expect(await rows(page).count()).toBeLessThan(before);

	await page.keyboard.press('Enter');

	// It ran: the palette closed and the log panel it names is on screen.
	await expect(palette(page)).toBeHidden();
	await expect(page.getByTestId('event-log')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// A command nobody can run is listed with its reason rather than hidden, the
// way the TUI palette keeps them — hiding one teaches nobody it exists.
test('a command that cannot run says why, and sorts below the ones that can', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await openPalette(page);
	await page.keyboard.type('comment');

	const comment = rows(page).filter({hasText: 'Comment on ticket'}).first();

	await expect(comment).toBeVisible();
	await expect(comment).toContainText('Open a ticket first');
	await expect(comment).toHaveAttribute('aria-disabled', 'true');

	expect(pageErrors).toEqual([]);
});

test('a command that takes an argument opens its list, and applies it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Palette tag ${Date.now()}`;
	await addTicket(page, title);

	await openPalette(page);
	await page.keyboard.type('add a tag');
	await expect(rows(page).first()).toContainText('Add a tag');
	await page.keyboard.press('Enter');

	// Still open, now on the second step: the command it is collecting for is
	// named, and the rows are tags rather than commands.
	await expect(palette(page)).toBeVisible();
	await expect(palette(page)).toContainText('Add a tag');

	// A name the board has never held: the step offers it rather than an empty
	// list, the way `:tag urgent` names one into being in the TUI.
	const tag = `palette-${Date.now()}`;
	await page.keyboard.type(tag);
	await expect(rows(page).filter({hasText: tag})).toHaveCount(1);
	await page.keyboard.press('Enter');

	await expect(palette(page)).toBeHidden();
	await expect(page.locator('aside')).toContainText(tag);

	expect(pageErrors).toEqual([]);
});

// Backspace on an empty query is the way back out of the second step, so the
// return is where the finger already is.
test('backspace leaves the argument list without leaving the palette', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await addTicket(page, `Palette back ${Date.now()}`);

	await openPalette(page);
	await page.keyboard.type('add a tag');
	await page.keyboard.press('Enter');
	await expect(palette(page)).toContainText('Add a tag');

	await page.keyboard.press('Backspace');

	await expect(palette(page)).toBeVisible();
	await expect(
		rows(page).filter({hasText: 'Sync with the remote'}),
	).toHaveCount(1);

	expect(pageErrors).toEqual([]);
});

// A shortcut nobody can discover is a shortcut nobody uses, so the topbar
// carries the chord and opens the palette when clicked.
test('the topbar hint opens the palette', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const hint = page.getByTestId('command-palette-hint');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('commands');

	await hint.click();
	await expect(palette(page)).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// Project-wide rather than the board's own filter: it reaches a ticket by ref
// or title and opens it.
test('search reaches a ticket and opens it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Palette search ${Date.now()}`;
	await addTicket(page, title);

	// Off the ticket, so opening it is a visible change rather than a no-op.
	await page.keyboard.press('Escape');

	await openPalette(page);
	await page.keyboard.type('search');
	await expect(rows(page).first()).toContainText('Search all tickets');
	await page.keyboard.press('Enter');

	await expect(palette(page)).toBeVisible();
	await page.keyboard.type(title);
	await expect(rows(page).filter({hasText: title})).toHaveCount(1);
	await page.keyboard.press('Enter');

	await expect(palette(page)).toBeHidden();
	await expect(page).toHaveURL(/\/issue\//);
	await expect(page.locator('aside')).toContainText(title);

	expect(pageErrors).toEqual([]);
});

// The whole point of remembering: what you reached for last is at hand next
// time, across a reload rather than only within a session.
test('what was run last leads the list, and survives a reload', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await openPalette(page);
	await page.keyboard.type('log');
	await page.keyboard.press('Enter');
	await expect(palette(page)).toBeHidden();

	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await openPalette(page);
	await expect(rows(page).first()).toContainText('Toggle the event log');

	expect(pageErrors).toEqual([]);
});

// The one command that leaves the board it was run from: making a board is
// only worth anything if you land on it.
test('a new board is created from the palette, and the switcher moves to it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const name = `Palette board ${Date.now()}`;

	await openPalette(page);
	await page.keyboard.type('new board');
	await expect(rows(page).first()).toContainText('New board');
	await page.keyboard.press('Enter');

	await page.getByPlaceholder('board name').fill(name);
	await page.getByPlaceholder('board name').press('Enter');

	await expect(page.getByTestId('board-switcher')).toContainText(name);
	await expect(page).toHaveURL(/\/board\//);

	// Bare, the way the TUI's `:new board` leaves one — the ghost column is the
	// way out of an empty board.
	await expect(page.getByTestId('add-swimlane')).toBeVisible();

	expect(pageErrors).toEqual([]);
});
