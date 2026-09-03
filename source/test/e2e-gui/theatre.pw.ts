import {expect, test} from './fixtures.js';
import {openBoard, returnToLive} from './live-board.js';

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
