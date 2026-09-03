import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Clicked rather than check()/uncheck(): the box is controlled through the URL,
// so its state comes back a tick later and Playwright's own re-click races it.

const ticketOnly = (page: Page) =>
	page.getByRole('checkbox', {name: 'This ticket'});

const scopeButton = (page: Page, name: string) =>
	page.getByRole('button', {name, exact: true});

const addTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);
};

// The narrowing needs a ticket for both halves of what it does, so with none
// open it is greyed rather than gone: the row must not change width every time
// the details panel opens and closes.
test('the ticket narrowing waits for a ticket, then owns the window', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await expect(ticketOnly(page)).toBeVisible();
	await expect(ticketOnly(page)).toBeDisabled();

	await addTicket(page, `Window target ${Date.now()}`);
	await expect(ticketOnly(page)).toBeEnabled();

	// A scope to hand back afterwards, so the restore below means something.
	await scopeButton(page, 'Week').click();
	await expect(scopeButton(page, 'Week')).toHaveAttribute(
		'aria-pressed',
		'true',
	);

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();
	await expect
		.poll(() => new URL(page.url()).searchParams.get('ticket'))
		.toBe('1');

	// The ticket's stretch is none of the periods the row lists, so none of them
	// reads as pressed — and it is not a dragged-out window either.
	await expect(scopeButton(page, 'Week')).toHaveAttribute(
		'aria-pressed',
		'false',
	);
	await expect(page.getByRole('button', {name: 'Zoom'})).toHaveAttribute(
		'aria-pressed',
		'false',
	);

	// Naming a scope is the way out, and the scope named is the one you get.
	await scopeButton(page, 'Day').click();
	await expect(ticketOnly(page)).not.toBeChecked();
	await expect(scopeButton(page, 'Day')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect
		.poll(() => new URL(page.url()).searchParams.get('ticket'))
		.toBeNull();

	expect(pageErrors).toEqual([]);
});

// It never writes a window into the selection, so what it hands back is
// whatever was in force — a dragged-out one included.
test('unticking hands back the window it was turned on over', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await addTicket(page, `Zoom holder ${Date.now()}`);

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, {steps: 10});
	await page.mouse.up();

	const zoom = page.getByRole('button', {name: 'Zoom'});
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');

	const dragged = new URL(page.url()).searchParams;
	const from = dragged.get('from');
	const to = dragged.get('to');
	expect(from).not.toBeNull();

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();
	// The dragged window is still in the URL, standing behind the ticket's.
	await expect(zoom).toHaveAttribute('aria-pressed', 'false');
	expect(new URL(page.url()).searchParams.get('from')).toBe(from);

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).not.toBeChecked();
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');
	const after = new URL(page.url()).searchParams;
	expect(after.get('from')).toBe(from);
	expect(after.get('to')).toBe(to);

	expect(pageErrors).toEqual([]);
});
