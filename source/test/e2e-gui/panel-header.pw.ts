import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

test.use({viewport: {width: 1600, height: 900}});

const openTicket = async (page: Page, appUrl: string, title: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
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
