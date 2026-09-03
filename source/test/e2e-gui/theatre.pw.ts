import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// The suite shares one server, and a board left parked in the past never
// finishes loading for the next test.
const returnToLive = async (page: Page) => {
	const exit = page.getByTestId('theatre-exit');
	// The button carries the word "Resume" only while the board is in the past,
	// so its absence is what live looks like.
	const resume = page.getByRole('button', {name: 'Resume', exact: true});

	if ((await exit.count()) > 0) await exit.click();

	// Pressed until it takes, rather than asked once: a request for live is a
	// message like any other and a socket replaced under it drops it silently,
	// which would leave the board parked in the past for the rest of the file.
	await expect(async () => {
		if ((await resume.count()) === 0) return;
		// Bounded: the word goes the moment live lands, and an unbounded click on
		// a button that has already lost its name would sit out the whole retry
		// budget.
		await resume.click({timeout: 1_000});

		await expect(resume).toHaveCount(0, {timeout: 2_000});
	}).toPass({timeout: 20_000});
};

const openBoard = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
};

test('the play button opens a player over a dimmed board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const play = page.getByTestId('theatre-play');
	await expect(play).toBeEnabled();
	await play.click();

	const player = page.getByTestId('theatre-player');
	await expect(player).toBeVisible();
	await expect(page.getByTestId('theatre-vignette')).toBeVisible();

	// The transport opens playing, so the first thing it offers is a pause.
	await expect(page.getByTestId('theatre-toggle')).toHaveAttribute(
		'aria-label',
		'Pause',
	);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The whole point of standing it down: two controls for one position fight
// over it, and the one the movie is not driving wins the last word.
test('the scrubber stands down while the player is up', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const track = page.getByTestId('scrubber-track');
	const box = await track.boundingBox();
	if (!box) throw new Error('scrubber track is not on screen');

	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();

	// The bar is faded and takes no pointer at all, so a click aimed at the
	// track lands on nothing rather than checking the board out somewhere else.
	await expect(track).toHaveCSS('pointer-events', 'none');
	await expect(page.getByRole('button', {name: 'Week', exact: true})).toHaveCSS(
		'pointer-events',
		'none',
	);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The movie is a checkout per event. If the clock did not wait on the server's
// answer, a long history would put hundreds of unanswered ones on the socket.
test('never asks for a second checkout before the first is answered', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	let inFlight = 0;
	let overlapped = false;

	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => {
			if (
				typeof message === 'string' &&
				message.includes('"type":"time-travel:scrub"')
			) {
				inFlight += 1;
				if (inFlight > 1) overlapped = true;
			}

			server.send(message);
		});

		server.onMessage(message => {
			if (
				typeof message === 'string' &&
				message.includes('"type":"time-travel:result"')
			) {
				inFlight = Math.max(0, inFlight - 1);
			}

			ws.send(message);
		});
	});

	await openBoard(page, appUrl);
	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();

	// Long enough for a short seeded history to play most of the way through.
	await page.waitForTimeout(6000);

	expect(overlapped).toBe(false);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

test('the transport pauses and resumes, and the movie ends on a full bar', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('theatre-play').click();

	const toggle = page.getByTestId('theatre-toggle');
	const bar = page.getByTestId('theatre-progress');

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-label', 'Play');

	const paused = await bar.getAttribute('aria-valuenow');
	await page.waitForTimeout(600);
	expect(await bar.getAttribute('aria-valuenow')).toBe(paused);

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-label', 'Pause');
	await expect
		.poll(async () => Number(await bar.getAttribute('aria-valuenow')))
		.toBeGreaterThan(Number(paused));

	// Dragged to the end rather than waited out: how long the movie runs is a
	// property of the seeded window, and the end is what this is about. The
	// transport says so by offering to play it again.
	const box = await bar.boundingBox();
	if (!box) throw new Error('the player bar is not on screen');

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width + 40, box.y + box.height / 2);
	await page.mouse.up();

	await expect(bar).toHaveAttribute('aria-valuenow', '100');
	await expect(toggle).toHaveAttribute('aria-label', 'Play again');

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The crawl is a slice of the script, not a list grown as events land, which
// is what keeps a long movie from adding a node per event to the overlay.
test('the pop-out puts the log beside the board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('theatre-play').click();

	const log = page.getByTestId('event-log');
	await expect(log).toHaveCount(0);

	const toggle = page.getByTestId('theatre-log-toggle');
	await toggle.click();
	await expect(log).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');

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

	await toggle.click();
	await expect(log).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});

// The panel is the board's, not the movie's: the pop-out and the Log box are
// two controls over one flag, and leaving the player does not take it away.
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

test('closing the player hands the board back, live and editable', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();

	await page.getByTestId('theatre-exit').click();

	await expect(page.getByTestId('theatre-player')).toHaveCount(0);
	await expect(page.getByTestId('theatre-vignette')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toHaveCount(0);
	await expect(page.getByTestId('scrubber-track')).not.toHaveCSS(
		'pointer-events',
		'none',
	);

	expect(pageErrors).toEqual([]);
});

test('escape leaves the player', async ({page, appUrl, pageErrors}) => {
	await openBoard(page, appUrl);
	await page.getByTestId('theatre-play').click();
	await expect(page.getByTestId('theatre-player')).toBeVisible();

	await page.keyboard.press('Escape');

	// Escape is the way out, and the way out hands the board back.
	await expect(page.getByTestId('theatre-player')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Resume', exact: true}),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

// The controls row is a long single line. Below the breakpoint the scope
// buttons — the widest thing on it — fold into one select, so the end of the
// row, where the transport is, is not squeezed off.
test('the scope row folds into a select on a narrow window', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.setViewportSize({width: 900, height: 800});
	await openBoard(page, appUrl);

	const select = page.getByTestId('scope-select');
	const week = page.getByRole('button', {name: 'Week', exact: true});

	await expect(select).toBeVisible();
	await expect(week).toHaveCount(0);

	// The transport survives the squeeze, being what the row loses first.
	await expect(page.getByTestId('theatre-play')).toBeVisible();

	// It names the scope in hand, and picking one from it moves the window.
	await select.click();
	await page.getByRole('option', {name: 'Week', exact: true}).click();
	await expect(select).toContainText('Week');
	await expect
		.poll(() => new URL(page.url()).searchParams.get('scope'))
		.toBe('week');

	// It closes when you look away from it: its popover sits over the chart, and
	// one left open would take the timeline's pointer with it.
	await select.click();
	await expect(
		page.getByRole('option', {name: 'Day', exact: true}),
	).toBeVisible();
	await page.getByTestId('board-switcher').click({position: {x: 2, y: 2}});
	await expect(
		page.getByRole('option', {name: 'Day', exact: true}),
	).toHaveCount(0);

	await select.click();
	await expect(
		page.getByRole('option', {name: 'Day', exact: true}),
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(
		page.getByRole('option', {name: 'Day', exact: true}),
	).toHaveCount(0);

	// Wide again, and the buttons come back rather than both forms showing.
	await page.setViewportSize({width: 1400, height: 800});
	await expect(week).toBeVisible();
	await expect(select).toHaveCount(0);

	await returnToLive(page);
	expect(pageErrors).toEqual([]);
});
