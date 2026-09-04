// The event log panel: what it holds, when it updates, and how it folds. The
// player is used here only where the behaviour under test is the log's.

import {expect, test} from './fixtures.js';
import {openBoard, returnToLive} from './live-board.js';

// The crawl is a slice of the script, not a list grown as events land, which
// is what keeps a long movie from adding a node per event to the overlay.
test('the log fills beside the board as the movie plays', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const log = page.getByTestId('event-log');
	const box = page.getByTestId('log-toggle');

	await expect(log).toHaveCount(0);

	// Opened before the movie: the bar stands down while the player owns the
	// board's position, so the Log box is not there to click once it is up.
	await box.click();
	await expect(log).toBeVisible();

	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();

	// Lines arrive as the movie plays. How many the panel holds at most is
	// event-log.test.ts's job — a bound asserted here would only be a bound on
	// the seeded window, which is smaller than the cap and so proves nothing.
	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(1);

	// The day each run of lines belongs to is called once above them, rather
	// than repeated on every line.
	await expect(page.getByTestId('log-day').first()).toBeVisible();

	// Every line is marked with its kind, commits included. The dot is a
	// pseudo-element rather than a node of its own — the panel holds hundreds of
	// these — so what is asserted is the colour each row hands it.
	// Evaluated as a string, like the other DOM reads in this suite: these files
	// are type-checked against the Node libs, which have no `HTMLElement`.
	const dotColours = (await page.evaluate(
		`[...document.querySelectorAll('[data-testid="log-line"]')]` +
			`.map(row => row.style.getPropertyValue('--epiq-log-dot').trim())`,
	)) as string[];

	// Against the rows that one read saw, not a count fetched separately: the
	// movie is still running, and a line arriving between the two reads made
	// this fail for saying nothing about the panel.
	expect(dotColours.length).toBeGreaterThan(0);
	expect(dotColours.every(colour => colour.length > 0)).toBe(true);

	// A panel, not a wash over the board: it takes its own width and the first
	// swimlane starts to the right of where it ends.
	const logBox = (await log.boundingBox())!;
	const lane = (await page
		.getByTestId('swimlane-handle')
		.first()
		.boundingBox())!;

	expect(logBox.width).toBeGreaterThan(100);
	expect(lane.x).toBeGreaterThanOrEqual(logBox.x + logBox.width);

	await page.getByTestId('theatre-exit').click();
	await box.click();
	await expect(log).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The panel is the board's, not the movie's: the Log box is the only control
// over it, and leaving the player does not take it away.
test('the log stays on the board after the player leaves', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const log = page.getByTestId('event-log');
	const box = page.getByTestId('log-toggle');

	await expect(log).toHaveCount(0);
	await box.click();
	await expect(log).toBeVisible();

	// Live, with no movie anywhere near it: the tail of the window.
	await expect
		.poll(async () => await page.getByTestId('log-line').count())
		.toBeGreaterThan(0);

	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();
	await expect(log).toBeVisible();

	await page.getByTestId('theatre-exit').click();
	await expect(page.getByTestId('theatre-player')).toHaveCount(0);

	// Still there, and still the same panel.
	await expect(log).toBeVisible();

	await box.click();
	await expect(log).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The log is drawn from the scrubber's window, which is fetched when the window
// moves — not when the board changes. Without the log asking for it too, a
// swimlane made while the panel is open never reaches the panel listing it.
test('the log picks up what happens on the board while it is open', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const box = page.getByTestId('log-toggle');
	await box.click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	// A swimlane, because it writes an event without needing a ticket first.
	const name = `log-live-${Date.now()}`;
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');

	await expect(page.getByText(name, {exact: true}).first()).toBeVisible();

	// Its line arrives without the window being touched. Asserted by what the
	// line says rather than by the count going up: the log is capped, and on a
	// board that has already filled it a new line pushes the oldest off the top
	// instead of adding to the tally.
	await expect(page.getByTestId('event-log')).toContainText(name);

	await box.click();
	await expect(page.getByTestId('event-log')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});

// Folding is what bounds the panel: a folded day is one row however many
// events it holds, so a long history is a handful of rows until asked for.
test('a day folds to its divider and opens again', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const box = page.getByTestId('log-toggle');
	await box.click();

	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	// The newest day is the one open by default.
	const day = page.getByTestId('log-day').last();
	await expect(day).toHaveAttribute('aria-expanded', 'true');

	await day.click();
	await expect(day).toHaveAttribute('aria-expanded', 'false');
	await expect(lines).toHaveCount(0);

	await day.click();
	await expect(day).toHaveAttribute('aria-expanded', 'true');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	await box.click();
	await expect(page.getByTestId('event-log')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});

// The log draws what the chart draws. Reciting events the picture above it is
// not showing makes the two disagree about what is in the window.
test('the log obeys the bar\u2019s own filters', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('log-toggle').click();

	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	// Commits go with the box that draws them.
	const code = page.getByRole('checkbox', {name: 'Code', exact: true});
	const commitColour = 'rgb(140, 233, 154)';
	const greens = async () =>
		(
			(await page.evaluate(
				`[...document.querySelectorAll('[data-testid="log-line"]')]` +
					`.map(row => getComputedStyle(row, '::after').backgroundColor)`,
			)) as string[]
		).filter(colour => colour === commitColour).length;

	await expect.poll(greens).toBeGreaterThan(0);
	await code.click();
	await expect.poll(greens).toBe(0);
	await code.click();
	await expect.poll(greens).toBeGreaterThan(0);

	// And the board series takes its own events with it.
	// The name sits on the wrapper, not the box: the box itself is unlabelled.
	const series = page.getByTitle('Show board events');
	const before = await lines.count();
	await series.click();
	await expect.poll(async () => await lines.count()).toBeLessThan(before);
	await series.click();

	await expect.poll(async () => await lines.count()).toBe(before);
	await page.getByTestId('log-toggle').click();
	expect(pageErrors).toEqual([]);
});

// The row carries where it goes and one handler on the pane reads it back, so
// what the unit tests cannot cover is exactly this: that a click on a line
// lands on the view the line named.
test('a line goes to where the thing it names is read', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	// The seeded board is a bare project — its log is the two setup commits and
	// the board and swimlanes, none of which happened to a ticket. So the line
	// worth following has to be made here.
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Followed ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	// Filing one opens it, which is the URL under test — so the board goes back
	// to showing no ticket before the click that has to produce it.
	await page.goto(boardUrl);
	await page.getByTestId('log-toggle').click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	const ticketLine = page.locator('[data-log-issue][data-log-tab="overview"]');
	await expect.poll(async () => await ticketLine.count()).toBeGreaterThan(0);
	await ticketLine.first().click();

	await expect(page).toHaveURL(/\/issue\/[A-Z0-9]{7}\?tab=overview/);

	// Board- and swimlane-level events happened to no ticket, and the setup
	// commits link to none either. They carry no destination at all, which is
	// what makes them inert without a second check.
	await page.goto(boardUrl);
	const inert = page.locator(
		'[data-testid="log-line"]:not([data-log-issue]):not([data-log-sha])',
	);
	await expect.poll(async () => await inert.count()).toBeGreaterThan(0);

	const before = page.url();
	await inert.first().click();
	await expect(page).toHaveURL(before);

	await page.getByTestId('log-toggle').click();
	expect(pageErrors).toEqual([]);
});

test('a line that leads somewhere says so under the pointer', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	// As above: the seeded board's own log is board- and swimlane-level events,
	// so a line that leads anywhere has to be made here.
	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Pointed ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	await page.goto(boardUrl);
	await page.getByTestId('log-toggle').click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	const arrow = page.getByTestId('log-row-arrow');
	await expect(arrow).toHaveCSS('opacity', '0');

	const linking = page.locator('[data-log-issue]').first();
	await expect.poll(async () => await linking.count()).toBeGreaterThan(0);
	await expect(linking).toHaveCSS('cursor', 'pointer');

	await linking.hover();
	await expect(arrow).toHaveCSS('opacity', '1');

	// On the hovered row, not merely somewhere in the panel: one arrow serves
	// every row, so where it sits is the whole of what it says.
	const rowBox = await linking.boundingBox();
	const arrowBox = await arrow.boundingBox();
	expect(rowBox).not.toBeNull();
	expect(arrowBox).not.toBeNull();
	expect(Math.abs(arrowBox!.y - rowBox!.y)).toBeLessThanOrEqual(1);
	// And at the end of the line rather than out in the panel's margin.
	expect(arrowBox!.x + arrowBox!.width).toBeLessThanOrEqual(
		rowBox!.x + rowBox!.width + 1,
	);

	// A line that leads nowhere stays inert, and takes the arrow away with it.
	const inert = page
		.locator(
			'[data-testid="log-line"]:not([data-log-issue]):not([data-log-sha])',
		)
		.first();
	await expect.poll(async () => await inert.count()).toBeGreaterThan(0);
	await expect(inert).not.toHaveCSS('cursor', 'pointer');

	await inert.hover();
	await expect(arrow).toHaveCSS('opacity', '0');

	await page.getByTestId('log-toggle').click();
	expect(pageErrors).toEqual([]);
});

// Reading back through the log is reading the moment the board stands at.
// Moving the timeline changes that moment, so the pane goes to the foot — a
// scrub that shortened the log by hundreds of lines used to leave it scrolled
// to where they had been, showing nothing.
test('moving the timeline takes the log to its foot, wherever it was', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	// Short, so a dozen lines is more than the pane can show.
	await page.setViewportSize({width: 1280, height: 420});
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	// Filed from the board behind the panel each one opens, so there is no
	// round trip per ticket; one line in the log apiece.
	const stamp = Date.now();
	for (let index = 0; index < 10; index++) {
		await page.getByTitle('Add issue').first().click();
		await page.getByPlaceholder('issue name').fill(`Foot ${stamp}-${index}`);
		await page.getByPlaceholder('issue name').press('Enter');
		await expect(page.locator('aside')).toContainText(`Foot ${stamp}-${index}`);
	}
	await page.goto(boardUrl);

	await page.getByTestId('log-toggle').click();
	const pane = page.getByTestId('event-log-scroll');
	await expect(pane).toBeVisible();
	await expect
		.poll(async () => await page.getByTestId('log-line').count())
		.toBeGreaterThan(10);

	const scrolled = () =>
		page.evaluate(`
(() => {
	const pane = document.querySelector('[data-testid="event-log-scroll"]');
	return {
		overflow: pane.scrollHeight - pane.clientHeight,
		fromFoot: pane.scrollHeight - pane.scrollTop - pane.clientHeight,
		top: pane.scrollTop,
	};
})()
`) as Promise<{overflow: number; fromFoot: number; top: number}>;

	// The premise: there is somewhere to scroll to. A pane that does not
	// overflow is at its foot whatever happens, and would prove nothing.
	await expect.poll(async () => (await scrolled()).overflow).toBeGreaterThan(0);

	// Read back to the top, which is the position a scrub used to keep.
	await page.evaluate(
		`document.querySelector('[data-testid="event-log-scroll"]').scrollTop = 0`,
	);
	await expect.poll(async () => (await scrolled()).top).toBe(0);

	// Into the past, but only just: the board stands at an earlier moment while
	// the log stays longer than the pane. A scrub that shortened it to fit would
	// leave the pane at its foot with nothing to prove — so that is asserted.
	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');
	await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toBeVisible();

	await expect.poll(async () => (await scrolled()).overflow).toBeGreaterThan(0);
	await expect
		.poll(async () => (await scrolled()).fromFoot)
		.toBeLessThanOrEqual(1);

	// And back to the present is a move of the timeline too.
	await page.evaluate(
		`document.querySelector('[data-testid="event-log-scroll"]').scrollTop = 0`,
	);
	await expect.poll(async () => (await scrolled()).top).toBe(0);
	await page.getByRole('button', {name: 'Resume', exact: true}).click();
	await expect
		.poll(async () => (await scrolled()).fromFoot)
		.toBeLessThanOrEqual(1);

	await page.getByTestId('log-toggle').click();
	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The hover arrow is positioned inside the scroll pane, and a positioned child
// holds the pane's overflow open wherever it is left. Hovered onto a row deep
// in a tall log and then orphaned by a movie emptying the column, it used to
// leave the foot snap scrolled into a stretch of nothing until the log grew
// back down to it.
test('an arrow left below the fold does not hold the pane open when the log empties', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.setViewportSize({width: 1280, height: 420});
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	const stamp = Date.now();
	for (let index = 0; index < 10; index++) {
		await page.getByTitle('Add issue').first().click();
		await page.getByPlaceholder('issue name').fill(`Arrow ${stamp}-${index}`);
		await page.getByPlaceholder('issue name').press('Enter');
		await expect(page.locator('aside')).toContainText(
			`Arrow ${stamp}-${index}`,
		);
	}
	await page.goto(boardUrl);

	await page.getByTestId('log-toggle').click();
	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(10);

	const overflow = () =>
		page.evaluate(`
(() => {
	const pane = document.querySelector('[data-testid="event-log-scroll"]');
	return pane.scrollHeight - pane.clientHeight;
})()
`) as Promise<number>;

	// The premise: the log is taller than the pane, so the newest row sits
	// below where the pane's foot will be once the column is empty.
	await expect.poll(overflow).toBeGreaterThan(0);
	await lines.last().hover();
	await expect(page.getByTestId('log-row-arrow')).toHaveCSS('opacity', '1');
	await page.mouse.move(900, 300);

	// A movie opens on the board before any of its events, with an empty log.
	// The pane has nothing to overflow with then — unless the arrow is holding
	// it open from where the last row used to be.
	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();
	await page.getByTestId('theatre-toggle').click();
	await expect(page.getByTestId('theatre-toggle')).toHaveAttribute(
		'aria-label',
		'Play',
	);

	await expect.poll(overflow).toBe(0);

	await returnToLive(page);
	await page.getByTestId('log-toggle').click();
	expect(pageErrors).toEqual([]);
});
