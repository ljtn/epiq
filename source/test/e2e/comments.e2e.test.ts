import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {
	ARROW_DOWN,
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = commandLineIsIdle;

type Tui = ReturnType<typeof setupTui>;

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

beforeAll(async () => {
	const tui = setupTui();
	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		await tui.destroy();
	}
});

describe('TUI comments', () => {
	// The compact row showed `[N]`; the wide card showed nothing, so widening
	// the terminal lost information.
	it(
		'shows the comment count on the board row in wide view too',
		async () => {
			const tui = setupTui();
			try {
				await commonSteps.init(tui);
				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				await run(tui, ':new issue Count badge', 'new issue Count badge');
				await tui.waitFor('Todo (1)', 4_000);
				await run(tui, ':comment first', 'comment first');
				await run(tui, ':comment second', 'comment second');

				// The dense board (the default) already shows the count.
				await tui.waitFor('[2]', 4_000);

				await run(tui, ':config view wide', 'config view wide');

				// The screen is now the wide board: the card, and on it the count.
				await tui.waitFor('Count badge', 4_000);
				await tui.waitFor('[2]', 4_000);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'wraps a long comment onto more rows instead of cutting it off',
		async () => {
			const tui = setupTui();
			try {
				await commonSteps.init(tui);
				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				await run(tui, ':new issue Wrap test', 'new issue Wrap test');
				await tui.waitFor('Todo (1)', 4_000);

				// Longer than the 120-column terminal, so the end can only be seen
				// on a second row.
				const tail = 'lands on its own row';
				const body = `${'a fairly long remark that keeps going '.repeat(
					3,
				)}${tail}`;
				await run(tui, `:comment ${body}`, 'comment a fairly');

				// Into the ticket, down to its Comments field, and in. Every press is
				// confirmed on the row it lands on before the next goes out: pressing
				// on a timer and checking the frame afterwards races the render, and
				// a slow one lets all six presses through — which walks the cursor off
				// the end of the six rows and back to the one it started on.
				tui.input(ENTER);
				await tui.waitFor('Comments (1) ››', 4_000);

				for (const row of [
					/❯\s+Assignees/,
					/❯\s+Tags/,
					/❯\s+History/,
					/❯\s+Comments \(1\)/,
				]) {
					tui.input(ARROW_DOWN);
					await tui.waitFor(row, 4_000);
				}

				tui.input(ENTER);
				await tui.waitFor('#1 ', 4_000);

				await tui.waitFor(tail, 4_000);
				expect(tui.output()).not.toContain('…');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
