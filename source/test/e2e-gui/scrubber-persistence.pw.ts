import {expect, test} from './fixtures.js';

const scatterPressed = (page: import('@playwright/test').Page) =>
	page.getByTitle(/^Events —/);

test('the chart layout survives a reload', async ({page, appUrl}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// Volume is the default, so the scatter is the one worth persisting.
	await expect(page.getByTestId('scatter-canvas')).toHaveCount(0);

	await scatterPressed(page).click();
	await expect(page.getByTestId('scatter-canvas')).toBeVisible();

	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('scatter-canvas')).toBeVisible();

	// And back, so the stored value tracks the choice rather than sticking.
	await page.getByTitle(/^Volume —/).click();
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('scatter-canvas')).toHaveCount(0);
});

// Storage deliberately does not keep a zoom, so the only thing carrying one
// across a route is the query string. Opening a ticket used to rebuild that
// query from scratch, which dropped the window and let the board fall back to
// the stored scope underneath the reader.
test('a dragged-out zoom survives opening a ticket', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	// The board seeds no tickets, so there has to be a card to open.
	const title = `Zoom target ${Date.now()}`;
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);

	// Back to the bare board, so the window dragged out below is the only
	// thing the query carries.
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const zoom = page.getByRole('button', {name: 'Zoom'});
	await expect(zoom).toHaveAttribute('aria-pressed', 'false');

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, {steps: 10});
	await page.mouse.up();

	await expect(zoom).toHaveAttribute('aria-pressed', 'true');

	const dragged = new URL(page.url()).searchParams;
	const from = dragged.get('from');
	const to = dragged.get('to');
	expect(from).not.toBeNull();
	expect(to).not.toBeNull();

	await page.locator('[draggable="true"]').filter({hasText: title}).click();
	await expect(page).toHaveURL(/\/issue\//);

	// The same window, not merely some window: a rebuilt query would leave Zoom
	// unpressed, and a re-derived one could land on different bounds.
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');
	const after = new URL(page.url()).searchParams;
	expect(after.get('from')).toBe(from);
	expect(after.get('to')).toBe(to);

	expect(pageErrors).toEqual([]);
});

// The same fallback drops the offset, which storage pins to 0 for the same
// reason it drops a zoom — so a board paged back to last week jumped to the
// present the moment a card on it was opened.
test('a paged-back window survives opening a ticket', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const title = `Paged target ${Date.now()}`;
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(title);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page.locator('aside')).toContainText(title);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByRole('button', {name: 'Week', exact: true}).click();
	await page.getByTitle('Earlier').click();
	await expect
		.poll(() => new URL(page.url()).searchParams.get('offset'))
		.toBe('1');

	await page.locator('[draggable="true"]').filter({hasText: title}).click();
	await expect(page).toHaveURL(/\/issue\//);

	await expect
		.poll(() => new URL(page.url()).searchParams.get('offset'))
		.toBe('1');

	expect(pageErrors).toEqual([]);
});
