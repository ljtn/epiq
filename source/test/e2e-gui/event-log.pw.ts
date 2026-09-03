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

	expect(dotColours).toHaveLength(await lines.count());
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
