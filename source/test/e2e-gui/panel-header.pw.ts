import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

test.use({viewport: {width: 1600, height: 900}});

const openTicket = async (page: Page, appUrl: string, title: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toBeVisible();
};

const dockTo = async (page: Page, side: 'bottom' | 'right') => {
	await page.getByTestId('panel-menu').click();
	await page.getByRole('button', {name: `Dock to ${side}`}).click();
};

// Their rows, as the reader sees them: two boxes share a row when each one's
// centre falls inside the other's height.
const sharesRowWithRef = async (page: Page, title: string) => {
	const ref = await page
		.locator('aside button[title^="Copy "]')
		.first()
		.boundingBox();
	const heading = await page
		.locator('aside')
		.getByText(title, {exact: true})
		.boundingBox();

	if (!ref || !heading) throw new Error('header parts not found');

	const refMiddle = ref.y + ref.height / 2;
	const headingMiddle = heading.y + heading.height / 2;

	return (
		refMiddle > heading.y &&
		refMiddle < heading.y + heading.height &&
		headingMiddle > ref.y &&
		headingMiddle < ref.y + ref.height
	);
};

// Left to right: the ref, then the title, then the age at the far end of the
// row. The slack belongs between the title and the age, not after all three.
test('the header row reads ref, title, then age against the right edge', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const title = `Header ${Date.now()}`;
	await openTicket(page, appUrl, title);
	await dockTo(page, 'bottom');

	const aside = page.locator('aside');
	const ref = await aside
		.locator('button[title^="Copy "]')
		.first()
		.boundingBox();
	const heading = await aside.getByText(title, {exact: true}).boundingBox();
	const age = await page.getByTestId('issue-created-at').boundingBox();

	if (!ref || !heading || !age) throw new Error('header parts not found');

	expect(heading.x).toBeGreaterThan(ref.x + ref.width);
	expect(age.x).toBeGreaterThan(heading.x + heading.width);

	// Against the right edge rather than trailing the title: the gap left of
	// the age is the wider one.
	const asideBox = await aside.boundingBox();
	const gapBefore = age.x - (heading.x + heading.width);
	const gapAfter = asideBox!.x + asideBox!.width - (age.x + age.width);
	expect(gapBefore).toBeGreaterThan(gapAfter);

	expect(pageErrors).toEqual([]);
});

// The age stands next to the panel's buttons, so it has to sit on their line:
// it used to belong to the group that aligns the ref and the title on their
// baseline, which left it off by a few pixels against everything beside it.
test('the age is centred on the line the panel buttons keep', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl, `Header ${Date.now()}`);
	await dockTo(page, 'bottom');

	const age = await page.getByTestId('issue-created-at').boundingBox();
	const close = await page
		.locator('aside')
		.getByRole('button', {name: 'Close', exact: true})
		.boundingBox();

	if (!age || !close) throw new Error('header parts not found');

	const ageMiddle = age.y + age.height / 2;
	const closeMiddle = close.y + close.height / 2;
	expect(Math.abs(ageMiddle - closeMiddle)).toBeLessThanOrEqual(1);

	expect(pageErrors).toEqual([]);
});

test('docked to the bottom the title rides in the header row, and moves back below it on the right', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const title = `Header ${Date.now()}`;
	await openTicket(page, appUrl, title);

	await dockTo(page, 'bottom');
	await expect(page.locator('aside')).toContainText(title);
	expect(await sharesRowWithRef(page, title)).toBe(true);

	await dockTo(page, 'right');
	await expect(page.locator('aside')).toContainText(title);
	expect(await sharesRowWithRef(page, title)).toBe(false);

	expect(pageErrors).toEqual([]);
});

// The header is one row now, so a title long enough to wrap would push the
// tabs and everything under them down the panel.
test('a long title gives up what does not fit rather than growing the row', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	// Trimmed, because saving trims it and the assertions read it back.
	const title = `Header ${'a title long enough to run out of room '.repeat(
		6,
	)}`.trim();
	await openTicket(page, appUrl, title);
	await dockTo(page, 'bottom');

	const heading = page.locator('aside').getByText(title, {exact: true});
	await expect(heading).toBeVisible();

	const box = await heading.boundingBox();
	expect(box?.height).toBeLessThan(40);
	// Clipped, not lost: the whole title is still there to be read on hover.
	await expect(heading).toHaveAttribute('title', title);

	expect(pageErrors).toEqual([]);
});

// Two rows run across the top of the window — the log's fields and the ticket
// panel's buttons — and they are read as one line. The log's used to sit flush
// against the top edge while the other kept a twenty-pixel inset, which put it
// thirteen pixels above it. The board between them keeps no row of its own
// since the switcher went to the topbar: its columns start on the same top
// edge the panes do, and each lane's header carries its own gap.
test('the rows across the top of the window sit on one line', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl, `Header ${Date.now()}`);

	await page.getByTestId('log-toggle').click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	const logButton = await page.getByTestId('log-pop-out').boundingBox();
	// By its band rather than by `aside`, which the log is one of too. The band
	// sits outside the scrolling pane, which is what keeps the scrollbar off it.
	const close = await page
		.getByTestId('aside-header')
		.getByRole('button', {name: 'Close', exact: true})
		.boundingBox();

	if (!logButton || !close) {
		throw new Error('header rows not found');
	}

	expect(Math.abs(logButton.y - close.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(logButton.height - close.height)).toBeLessThanOrEqual(1);

	// And the board starts where the panes either side of it do.
	const pane = await page.getByTestId('event-log').boundingBox();
	const lane = await page.getByTestId('swimlane-handle').first().boundingBox();

	if (!pane || !lane) throw new Error('board rows not found');

	expect(Math.abs(pane.y - lane.y)).toBeLessThanOrEqual(2);

	expect(pageErrors).toEqual([]);
});

// Editing still has to work from the row it now sits in.
test('the title opens its editor from the header row', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	const title = `Header ${Date.now()}`;
	await openTicket(page, appUrl, title);
	await dockTo(page, 'bottom');

	await page.locator('aside').getByText(title, {exact: true}).click();

	await expect(page.locator('aside textarea').first()).toHaveValue(title);

	expect(pageErrors).toEqual([]);
});
