import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Clicked rather than check()/uncheck(): the box is controlled through the URL,
// so its state comes back a tick later and Playwright's own re-click races it.

const ticketOnly = (page: Page) =>
	page.getByRole('checkbox', {name: 'Ticket only'});

const scopeButton = (page: Page, name: string) =>
	page.getByRole('button', {name, exact: true});

// Counts the timeline replies the page is handed, so a test can say that
// clicking around asked the server for nothing.
const watchTimeline = async (page: Page) => {
	const seen = {count: 0};

	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => server.send(message));
		server.onMessage(message => {
			if (
				typeof message === 'string' &&
				message.startsWith('{"type":"timeline"')
			) {
				seen.count += 1;
			}

			ws.send(message);
		});
	});

	return seen;
};

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

// The point of narrowing the board too: the ticket's own card can be watched
// crossing the lanes on its own, with nothing else moving around it.
test('it takes the board down to the one ticket, and the window box with it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const mine = `Kept ${Date.now()}`;
	const other = `Hidden ${Date.now()}`;
	await addTicket(page, other);
	await addTicket(page, mine);

	const card = (title: string) =>
		page.locator('[draggable="true"]').filter({hasText: title});

	await expect(card(mine)).toBeVisible();
	await expect(card(other)).toBeVisible();

	// A period, so the window box is live enough to be worth putting out.
	await scopeButton(page, 'Week').click();
	const scopeOnly = page.getByRole('checkbox', {name: 'Scope only'});
	await expect(scopeOnly).toBeEnabled();
	await scopeOnly.click();
	await expect(scopeOnly).toBeChecked();

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();

	// One lit box, not two: the narrower ask took the other with it.
	await expect(scopeOnly).not.toBeChecked();
	await expect(scopeOnly).toBeDisabled();
	await expect
		.poll(() => new URL(page.url()).searchParams.get('window'))
		.toBeNull();

	await expect(card(mine)).toBeVisible();
	await expect(card(other)).toHaveCount(0);

	// And back: unticking returns every card and hands the window box back.
	await ticketOnly(page).click();
	await expect(ticketOnly(page)).not.toBeChecked();
	await expect(card(other)).toBeVisible();
	await expect(scopeOnly).toBeEnabled();

	expect(pageErrors).toEqual([]);
});

// The window is the ticket's only while the narrowing is on. With it off, one
// ticket is as good as another to the scrubber, and asking the server for the
// whole timeline again on every click between two of them made selecting a
// ticket crawl.
test('selecting tickets asks for no timeline while the narrowing is off', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const seen = await watchTimeline(page);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const first = `Quiet first ${Date.now()}`;
	const second = `Quiet second ${Date.now()}`;
	await addTicket(page, first);
	await addTicket(page, second);

	const card = (title: string) =>
		page.locator('[draggable="true"]').filter({hasText: title}).first();

	// Let everything creating the tickets set off settle before counting.
	await page.waitForTimeout(1500);
	const before = seen.count;

	await card(first).click();
	await expect(page).toHaveURL(/\/issue\//);
	await card(second).click();
	await card(first).click();
	await page.waitForTimeout(1500);

	expect(seen.count).toBe(before);

	// And with it on, the ticket *is* the window, so switching does ask again.
	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();
	await page.waitForTimeout(1500);
	expect(seen.count).toBeGreaterThan(before);

	expect(pageErrors).toEqual([]);
});

// A mode you are in rather than something the next click quietly cancels: the
// narrowing follows to whichever ticket is opened next and re-derives there.
test('it follows to the next ticket rather than being cancelled by it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const first = `Follow first ${Date.now()}`;
	const second = `Follow second ${Date.now()}`;
	await addTicket(page, first);
	await addTicket(page, second);

	// Open the first, narrow to it, then reach the second through the filter —
	// the board is down to one card, so there is no second card to click.
	await page
		.locator('[draggable="true"]')
		.filter({hasText: first})
		.first()
		.click();
	await expect(page).toHaveURL(/\/issue\//);

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();
	await expect(
		page.locator('[draggable="true"]').filter({hasText: second}),
	).toHaveCount(0);

	const firstUrl = page.url();

	await ticketOnly(page).click();
	await expect(ticketOnly(page)).not.toBeChecked();
	await page
		.locator('[draggable="true"]')
		.filter({hasText: second})
		.first()
		.click();
	await expect(page).not.toHaveURL(firstUrl);

	// Back on: from here, opening another ticket must keep it ticked.
	await ticketOnly(page).click();
	await expect(ticketOnly(page)).toBeChecked();

	await page.goBack();
	await expect(page).toHaveURL(/\/issue\//);
	await expect(ticketOnly(page)).toBeChecked();
	await expect
		.poll(() => new URL(page.url()).searchParams.get('ticket'))
		.toBe('1');

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
