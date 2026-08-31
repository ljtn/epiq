import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

const openFirstTicket = async (page: Page, title: string) => {
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
};

test.beforeEach(async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
});

// The suite shares one server per worker, and a checkout parks the whole board
// in the past. A test that fails before it resumes would hand every later test
// on that worker a read-only board.
test.afterEach(async ({page}) => {
	const resume = page.getByRole('button', {name: 'Resume', exact: true});

	if ((await resume.count()) > 0 && (await resume.isEnabled())) {
		await resume.click();
		await expect(
			page.getByRole('button', {name: 'Now', exact: true}),
		).toBeVisible();
	}
});

test('the log tab lists the ticket’s own events', async ({
	page,
	pageErrors,
}) => {
	const title = `History ${Date.now()}`;
	await openFirstTicket(page, title);

	await page.getByRole('button', {name: /^Log/}).click();

	const history = page.getByTestId('issue-history');
	await expect(history).toBeVisible();
	// Phrased by the same formatter the TUI log uses.
	await expect(history).toContainText(`Created with title "${title}"`);

	// A further change lands in the same list, newest first.
	await page.getByRole('button', {name: 'Overview'}).click();
	await page.getByRole('button', {name: 'close issue'}).click();

	await page.getByRole('button', {name: /^Log/}).click();
	await expect(history.locator('> div').first()).toContainText('Closed');
	await expect(history).toContainText('Created with title');

	expect(pageErrors).toEqual([]);
});

test('the panel header names when the ticket was created', async ({page}) => {
	const title = `Created ${Date.now()}`;
	await openFirstTicket(page, title);

	const created = page.getByTestId('issue-created-at');
	await expect(created).toBeVisible();
	await expect(created).toContainText(/Created (just now|\d+\w+ ago)/);
	// The exact timestamp stays on hover rather than crowding the line.
	await expect(created).toHaveAttribute(
		'title',
		new RegExp(String(new Date().getFullYear())),
	);

	// It lives in the header beside the ref, not in the Overview pane, so it
	// survives a tab change.
	await page.getByRole('button', {name: /^Log/}).click();
	await expect(created).toBeVisible();
});

test('the log tab survives a reload on its own url', async ({page}) => {
	const title = `Deep link ${Date.now()}`;
	await openFirstTicket(page, title);

	await page.getByRole('button', {name: /^Log/}).click();
	await expect(page).toHaveURL(/tab=history/);

	await page.reload();
	await expect(page.getByTestId('issue-history')).toBeVisible();
});

// The point of the button: the board it parks you on is the board that existed
// then, so the pane beside the Log carries the description of that moment
// rather than today's.
test('checking out a Log row reads the description as it was then', async ({
	page,
	pageErrors,
}) => {
	const title = `Checkout ${Date.now()}`;
	await openFirstTicket(page, title);

	const aside = page.locator('aside');

	// Waiting for the saved text to be on screen, not merely for the editor to
	// shut: the broadcast a save comes back as is what closes any open editor,
	// so reopening one before it lands is a race the loaded machine loses.
	const editDescription = async (text: string) => {
		await page.getByRole('button', {name: 'edit'}).first().click();
		const box = page.getByRole('textbox').last();
		await box.fill(text);
		await box.press('Enter');
		await expect(aside).toContainText(text);
		await expect(
			page.getByRole('button', {name: 'edit'}).first(),
		).toBeVisible();
	};

	await editDescription('first draft');
	await editDescription('second draft');

	await page.getByRole('button', {name: /^Log/}).click();

	const rows = page.getByTestId('issue-history-row');
	// Newest first, and nothing else has touched this ticket: the second edit,
	// the first edit, then the creation. Asserted so the index below cannot
	// drift onto a row that means something else.
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText('Changed description');
	await expect(rows.nth(1)).toContainText('Changed description');
	await expect(rows.nth(2)).toContainText('Created with title');

	// The older of the two edits, so the board it checks out is the one holding
	// the draft that was later replaced.
	await rows.nth(1).getByTestId('issue-history-checkout').click();

	const resume = page.getByRole('button', {name: 'Resume', exact: true});
	await expect(resume).toBeEnabled();

	// The Log is now the log of that moment too: the edit checked out is the
	// newest thing that had happened.
	await expect(rows).toHaveCount(2);

	// Asserted on the details pane rather than the page: the board behind it
	// carries this ticket's title too.
	await page.getByRole('button', {name: 'Overview'}).click();
	// The cut lands one past the event rather than one short of it: stopping
	// before the edit would have shown the empty description it replaced.
	await expect(aside).toContainText('first draft');
	await expect(aside).not.toContainText('second draft');

	await resume.click();
	await expect(
		page.getByRole('button', {name: 'Now', exact: true}),
	).toBeVisible();
	await expect(aside).toContainText('second draft');

	expect(pageErrors).toEqual([]);
});
