// The event log panel: what it holds, when it updates, and how it folds. The
// player is used here only where the behaviour under test is the log's.

import {expect, test} from './fixtures.js';
import {trackWithWindow} from './track.js';
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
	const code = page.getByTestId('show-commits');
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
	const series = page.getByTestId('show-board-events');
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
	await page.getByTestId('add-issue').first().click();
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
	await page.getByTestId('add-issue').first().click();
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

	// A layer of its own, or its opaque ground paints under the very text it is
	// there to cut off: every row is positioned too, and they all come after
	// the chip in the pane. jola saw a long title running across the word.
	await expect(arrow).toHaveCSS('z-index', '1');

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
		await page.getByTestId('add-issue').first().click();
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
	const track = await trackWithWindow(page);
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');
	await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
	await expect(
		page.getByRole('button', {name: 'Now', exact: true}),
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
	await page.getByRole('button', {name: 'Now', exact: true}).click();
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
		await page.getByTestId('add-issue').first().click();
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

// Dragged to size from its board-side edge, and the width kept for the next
// open, as the ticket panel on the other side is.
test('the log is dragged to size, and keeps its width', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('log-toggle').click();

	const log = page.getByTestId('event-log');
	await expect(log).toBeVisible();
	// The pane arrives on the board rather than appearing on it, and its edge
	// is what this grabs: measured mid-arrival, the handle is at a place it has
	// already left by the time the pointer gets there.
	await expect(log).toHaveAttribute('data-settled', 'true');
	const before = (await log.boundingBox())!;

	const handle = (await page.getByTestId('event-log-resize').boundingBox())!;
	const x = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 120, y, {steps: 8});
	await page.mouse.up();

	const after = (await log.boundingBox())!;
	expect(Math.round(after.width - before.width)).toBe(120);

	// The board moves over, as it does for the panel's opening.
	const lane = (await page
		.getByTestId('swimlane-handle')
		.first()
		.boundingBox())!;
	expect(lane.x).toBeGreaterThanOrEqual(after.x + after.width);

	await page.reload();
	await expect(log).toBeVisible();
	expect(Math.round((await log.boundingBox())!.width)).toBe(
		Math.round(after.width),
	);

	expect(pageErrors).toEqual([]);
});

// Dragged narrow, the five boxes used to run under the buttons at the far end
// and off the pane with them. They fold into one control instead — the same
// boxes, still reaching the rows.
test('the field boxes fold into a menu when the pane is too narrow', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('log-toggle').click();

	const log = page.getByTestId('event-log');
	await expect(log).toBeVisible();
	await expect(log).toHaveAttribute('data-settled', 'true');
	const header = page.getByTestId('event-log-header');
	await expect(header.getByLabel('Label', {exact: true})).toBeVisible();
	await expect(page.getByTestId('log-fields-menu')).toHaveCount(0);

	const handle = (await page.getByTestId('event-log-resize').boundingBox())!;
	const x = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 120, y, {steps: 8});
	await page.mouse.up();

	const menu = page.getByTestId('log-fields-menu');
	await expect(menu).toBeVisible();
	await expect(header.getByLabel('Label', {exact: true})).toHaveCount(0);

	// The symptom itself: every control the header carries is inside the pane.
	const pane = (await log.boundingBox())!;
	for (const id of ['log-fields-menu', 'log-split', 'log-pop-out']) {
		const box = (await page.getByTestId(id).boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(pane.x);
		expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
	}

	// Folded, a box still takes its column away.
	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);
	await menu.click();
	await header.getByLabel('Time', {exact: true}).click();
	await expect(page.locator('.epiq-log-pane').first()).toHaveClass(
		/epiq-log--no-time/,
	);

	expect(pageErrors).toEqual([]);
});

// Each line is its clock, who did it, the dot for its kind, and the line
// itself. The header at the top of the panel takes any of them away, all four
// are on until then, and the choice outlives the page.
test('the header chooses what each line shows, and keeps the choice', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('log-toggle').click();

	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	const header = page.getByTestId('event-log-header');
	for (const field of ['Time', 'Type', 'Actor', 'Diff', 'Label']) {
		await expect(header.getByLabel(field, {exact: true})).toBeChecked();
	}

	// The boxes are in the order a row draws what they control, so the one you
	// reach for is the column you meant. The clock, the dot and the name are
	// placed by the stylesheet, so their order is measured rather than
	// declared; the stat and the label follow in the row's own content order.
	const boxes = await header.locator('label').allInnerTexts();
	const placed = (await page.evaluate(
		`(() => {
			const name = document.querySelector('.epiq-log-actor');
			const row = name.closest('.epiq-log-line');
			const at = pseudo => parseFloat(getComputedStyle(row, pseudo).left);
			return [
				{name: 'Time', at: at('::before')},
				{name: 'Type', at: at('::after')},
				{
					name: 'Actor',
					at:
						name.getBoundingClientRect().left -
						row.getBoundingClientRect().left,
				},
			];
		})()`,
	)) as {name: string; at: number}[];
	expect(boxes.slice(0, 3)).toEqual(
		[...placed].sort((a, b) => a.at - b.at).map(column => column.name),
	);
	expect(boxes.slice(3)).toEqual(['Diff', 'Label']);

	// The clock and the dot are pseudo-elements, so what is asserted is
	// whether the browser still draws them.
	const pseudoDisplay = async (pseudo: string) =>
		(await page.evaluate(
			`getComputedStyle(document.querySelector('[data-testid="log-line"]'),` +
				`'${pseudo}').display`,
		)) as string;

	expect(await pseudoDisplay('::before')).not.toBe('none');
	expect(await pseudoDisplay('::after')).not.toBe('none');

	// The names are a column, as wide as the widest of them: every span is
	// that width, whatever its own name's length. (The seeded names happen to
	// be equally long, so the column's width is checked against the pane's own
	// figure rather than between spans; which name sets it is unit-tested.)
	const actorColumn = (await page.evaluate(
		`(() => {
			const panel = document.querySelector('[data-testid="event-log"]');
			const spans = [...document.querySelectorAll('.epiq-log-actor')];
			return {
				chars: getComputedStyle(panel).getPropertyValue('--epiq-log-actor-width').trim(),
				widest: Math.max(...spans.map(span => span.textContent.length)),
				widths: spans.map(span => Math.round(span.getBoundingClientRect().width)),
				// A name within the cap is shown whole: the column is sized to it.
				cut: spans.some(span => span.scrollWidth > span.clientWidth),
			};
		})()`,
	)) as {chars: string; widest: number; widths: number[]; cut: boolean};
	expect(actorColumn.widths.length).toBeGreaterThan(1);
	expect(actorColumn.cut).toBe(false);

	// The seed's board events are signed claude/tester, which the log draws
	// without its provider; the full name is kept in the title. The commits'
	// author is a person and stays as written.
	const agent = page.locator('.epiq-log-actor', {hasText: 'tester'}).first();
	await expect(agent).toHaveText('/tester');
	await expect(agent).toHaveAttribute('title', 'claude/tester');
	await expect(
		page.locator('.epiq-log-actor', {hasText: 'claude/'}),
	).toHaveCount(0);
	expect(actorColumn.chars).toContain(`${actorColumn.widest}ch`);
	expect(new Set(actorColumn.widths).size).toBe(1);

	// A commit's line carries what it did to the code; the seeded log opens
	// with the setup commits, one of which added files. The stat is not a
	// column: it pushes that row's label along and no other row's.
	const diff = page.locator('.epiq-log-diff').first();
	await expect(diff).toBeVisible();
	await expect(diff).toContainText('+');
	const insets = (await page.evaluate(
		`[...document.querySelectorAll('[data-testid="log-line"]')]` +
			`.map(row => getComputedStyle(row).paddingLeft)`,
	)) as string[];
	expect(new Set(insets).size).toBe(1);
	await header.getByLabel('Diff', {exact: true}).click();
	await expect(diff).toBeHidden();
	await header.getByLabel('Diff', {exact: true}).click();
	await expect(diff).toBeVisible();

	// Where the text starts: the row's padding, which is what the clock's
	// column and the dot's gap add up to.
	const textInset = async () =>
		parseFloat(
			(await page.evaluate(
				`getComputedStyle(document.querySelector('[data-testid="log-line"]')).paddingLeft`,
			)) as string,
		);

	const withEverything = await textInset();

	await header.getByLabel('Time', {exact: true}).click();
	await expect.poll(() => pseudoDisplay('::before')).toBe('none');
	// The dot moves up into the room the clock left, and the line with it.
	expect(await pseudoDisplay('::after')).not.toBe('none');
	const withoutClock = await textInset();
	expect(withoutClock).toBeLessThan(withEverything);

	// And the text moves left again once the dot goes: its gap is not kept.
	await header.getByLabel('Type', {exact: true}).click();
	await expect.poll(() => pseudoDisplay('::after')).toBe('none');
	expect(await textInset()).toBeLessThan(withoutClock);

	// With the name, the stat and the label all off, a line has nothing left
	// to say.
	await header.getByLabel('Actor', {exact: true}).click();
	await header.getByLabel('Diff', {exact: true}).click();
	await header.getByLabel('Label', {exact: true}).click();
	await expect(lines.first()).toHaveText('', {useInnerText: true});

	await page.reload();
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);
	for (const field of ['Time', 'Type', 'Actor', 'Diff', 'Label']) {
		await expect(header.getByLabel(field, {exact: true})).not.toBeChecked();
	}
	await expect(lines.first()).toHaveText('', {useInnerText: true});

	await header.getByLabel('Label', {exact: true}).click();
	await expect(lines.first()).not.toHaveText('', {useInnerText: true});

	expect(pageErrors).toEqual([]);
});

// Split, the panel stops being one interleaved column and becomes a lane per
// actor: a line keeps its place in time and moves sideways into its own
// actor's lane, which the heading above it names.
test('the header splits the log into a lane per actor', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('log-toggle').click();

	const lines = page.getByTestId('log-line');
	await expect.poll(async () => await lines.count()).toBeGreaterThan(0);

	const header = page.getByTestId('event-log-header');
	const heads = page.getByTestId('log-lane-heads');

	await expect(heads).toHaveCount(0);

	await header.getByLabel('Split', {exact: true}).click();
	await expect(heads).toBeVisible();

	// The name column folds to nothing — the lane says who — and its box stands
	// down rather than claiming to show a column that is not there. The names
	// stay in the page for a reader who cannot see the lanes.
	await expect(header.getByLabel('Actor', {exact: true})).toBeDisabled();
	await expect(page.locator('.epiq-log-actor').first()).toHaveText(/\S/);
	expect(
		await page.evaluate(
			`getComputedStyle(document.querySelector('.epiq-log-pane'))` +
				`.getPropertyValue('--epiq-log-actor-width').trim()`,
		),
	).toBe('0px');

	// Who signed each line and where the line was put, in one read: the board is
	// live, so a name taken before the click and an inset taken after it would
	// be two different columns paired by position.
	const placed = (await page.evaluate(
		`(() => {
			const lanes = [...document.querySelectorAll('[data-testid="log-lane-heads"] > span')]
				.map(head => ({name: head.textContent, left: head.getBoundingClientRect().left}));
			const rows = [...document.querySelectorAll('[data-testid="log-line"]')].map(row => {
				const box = row.getBoundingClientRect();
				const start = box.left + parseFloat(getComputedStyle(row).paddingLeft);
				return {
					actor: row.querySelector('.epiq-log-actor')?.textContent ?? null,
					// The lane whose heading stands over where this line starts.
					lane: lanes.findIndex(lane => Math.abs(lane.left - start) < 1),
					// A line nobody signed spans every lane rather than sitting in one.
					full: Math.round(box.width) === Math.round(row.parentElement.getBoundingClientRect().width),
				};
			});
			return {lanes: lanes.map(lane => lane.name), rows};
		})()`,
	)) as {
		lanes: string[];
		rows: {actor: string | null; lane: number; full: boolean}[];
	};

	expect(placed.lanes.length).toBeGreaterThan(0);
	expect(placed.rows.length).toBeGreaterThan(0);

	for (const row of placed.rows) {
		if (row.actor === null) {
			expect(row.full).toBe(true);
			continue;
		}

		// Every signed line starts under a heading, and under its own.
		expect(row.lane).toBeGreaterThanOrEqual(0);
		expect(placed.lanes[row.lane]).toBe(row.actor);
	}

	// Each name has a lane of its own, not one between them.
	const signed = new Set(
		placed.rows.map(row => row.actor).filter(actor => actor !== null),
	);
	expect(
		new Set(placed.rows.filter(row => row.actor).map(row => row.lane)).size,
	).toBe(signed.size);

	// The choice outlives the page, as the field boxes do.
	await page.reload();
	await expect(page.getByTestId('log-lane-heads')).toBeVisible();

	await page
		.getByTestId('event-log-header')
		.getByLabel('Split', {exact: true})
		.click();
	await expect(page.getByTestId('log-lane-heads')).toHaveCount(0);
	await expect(page.locator('.epiq-log-actor').first()).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The log goes into a window of its own and the panel leaves the board; the
// window is fed by the board and hands its clicks back; closing it brings the
// panel back.
test('the log pops out into its own window, and comes back when it closes', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	// A line worth following, as in the destination test above.
	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Popped ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await page.goto(boardUrl);

	const box = page.getByTestId('log-toggle');
	await box.click();
	const panel = page.getByTestId('event-log');
	await expect(panel).toBeVisible();

	const popupOpened = page.context().waitForEvent('page');
	await page.getByTestId('log-pop-out').click();
	const popup = await popupOpened;

	// The board's panel goes; the window fills with the same lines.
	await expect(panel).toHaveCount(0);
	await expect(box).toHaveAttribute('aria-pressed', 'true');
	const popped = popup.getByTestId('event-log');
	await expect(popped).toBeVisible();
	await expect
		.poll(async () => await popup.getByTestId('log-line').count())
		.toBeGreaterThan(0);

	// Fed live: what happens on the board reaches the window.
	const name = `log-window-${Date.now()}`;
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(popped).toContainText(name);

	// A click in the window opens the ticket on the board.
	await popup
		.locator('[data-log-issue][data-log-tab="overview"]')
		.first()
		.click();
	await expect(page).toHaveURL(/\/issue\/[A-Z0-9]{7}\?tab=overview/);

	// The window's own way back, which is the same as closing it.
	await popup.getByTestId('log-dock').click();
	await expect(panel).toBeVisible();
	await expect(box).toHaveAttribute('aria-pressed', 'true');

	// Turning the log off takes the window with it.
	const again = page.context().waitForEvent('page');
	await page.getByTestId('log-pop-out').click();
	const second = await again;
	await expect(second.getByTestId('event-log')).toBeVisible();
	await box.click();
	await expect.poll(() => second.isClosed()).toBe(true);
	await expect(panel).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// WKK7PS0. The tab was as far as a comment line went: on a ticket with a
// dozen comments the reader arrived among them and still had to find the one
// the line was about.
test('a comment line leads to the comment, not just its tab', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	const boardUrl = page.url();

	await page.getByTestId('add-issue').first().click();
	await page.getByPlaceholder('issue name').fill(`Commented ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');

	// Two of them, so landing on one is a different outcome from landing on
	// the tab: with a single comment the tab and the comment are the same
	// place, and the test would pass without the anchor.
	//
	// Stamped, because the log they are looked for in is the whole board's and
	// this worker's repo is shared with every other spec file that ran before
	// this one — `comments.pw.ts` and `insert-image.pw.ts` both write some.
	await page.getByRole('button', {name: /^Comments/}).click();
	const stamp = Date.now();
	const older = `older ${stamp}`;
	const newer = `newer ${stamp}`;
	for (const text of [older, newer]) {
		await page.getByPlaceholder('write a comment').fill(text);
		await page.getByRole('button', {name: 'comment', exact: true}).click();
		await expect(page.locator('aside').getByText(text)).toBeVisible();
	}

	await page.goto(boardUrl);
	await page.getByTestId('log-toggle').click();
	await expect(page.getByTestId('event-log')).toBeVisible();

	// This ticket's two comment lines, found by what they say rather than by
	// counting the log: a comment's line is labelled `Commented: <the comment>`,
	// and every other spec's comments are in here too. Counting them all was
	// the same assertion only while this file happened to run first on its
	// worker, which is a coin toss (YAXMFDF).
	const commentLines = page.locator('[data-log-tab="comments"]');
	const olderLine = commentLines.filter({hasText: older});

	await expect(olderLine).toHaveCount(1);
	await expect(commentLines.filter({hasText: newer})).toHaveCount(1);

	await expect(olderLine).toHaveAttribute('data-log-comment', /.+/);
	const commentId = await olderLine.getAttribute('data-log-comment');
	await olderLine.click();

	// Named in the URL, so the reader can hand the link on and come back to it.
	await expect(page).toHaveURL(new RegExp(`comment=${commentId}`));

	// And marked, on the older comment rather than on whichever is uppermost:
	// the panel puts the newest first, so a mark that landed by position would
	// be on the wrong one here.
	const marked = page.getByTestId('comment-card-focused');
	await expect(marked).toHaveCount(1);
	await expect(marked).toContainText(older);

	expect(pageErrors).toEqual([]);
});
