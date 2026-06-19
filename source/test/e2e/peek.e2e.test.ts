import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';
const ESCAPE = '\x1B';

type Tui = ReturnType<typeof setupTui>;

// Run a command-line command and wait for it to fully settle. Commands are
// echoed into the (async) command-line buffer first, so we wait for the echo,
// then submit, then wait for the line to clear. Firing the next command before
// this completes lets keystrokes merge into a single un-submitted buffer.
const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

// A newly created issue becomes the selected node, so the next `:new issue`
// stacks on top of the last in the same swimlane.
const createIssue = async (tui: Tui, title: string) => {
	await run(tui, `:new issue ${title}`, `new issue ${title}`);
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
	}
});

describe('TUI peek / time-travel e2e', () => {
	it(
		'steps through historical board states and resumes live',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// Three issues created in order. Each `:new issue` is one event in the
				// log, so `:peek prev` / `:peek next` step the board one issue at a
				// time — the deterministic spine of the time-travel feature.
				await createIssue(tui, 'First issue');
				await createIssue(tui, 'Second issue');
				await createIssue(tui, 'Third issue');

				const live = await tui.waitFor(
					output =>
						output.includes('Todo (3)') &&
						output.includes('First issue') &&
						output.includes('Second issue') &&
						output.includes('Third issue'),
					4_000,
				);
				// Live board: no read-only banner yet.
				expect(live).not.toContain('Readonly');

				// --- :peek prev — rewind one event: the newest issue vanishes and
				//     the board enters the read-only "peek" mode. ---
				await run(tui, ':peek prev', 'peek prev');
				const onePrev = await tui.waitFor(
					output =>
						output.includes('Readonly') &&
						output.includes('Todo (2)') &&
						output.includes('First issue') &&
						output.includes('Second issue') &&
						!output.includes('Third issue'),
					4_000,
				);
				expect(onePrev).toContain('Readonly');
				expect(onePrev).toContain('Second issue');
				expect(onePrev).not.toContain('Third issue');

				// --- :peek prev again — rewind another event. ---
				await run(tui, ':peek prev', 'peek prev');
				const twoPrev = await tui.waitFor(
					output =>
						output.includes('Todo (1)') &&
						output.includes('First issue') &&
						!output.includes('Second issue') &&
						!output.includes('Third issue'),
					4_000,
				);
				expect(twoPrev).toContain('First issue');
				expect(twoPrev).not.toContain('Second issue');

				// --- :peek next — fast-forward one event: the second issue returns. ---
				await run(tui, ':peek next', 'peek next');
				const oneNext = await tui.waitFor(
					output =>
						output.includes('Todo (2)') &&
						output.includes('First issue') &&
						output.includes('Second issue') &&
						!output.includes('Third issue'),
					4_000,
				);
				expect(oneNext).toContain('Second issue');
				expect(oneNext).not.toContain('Third issue');

				// --- :peek now — leave read-only mode and snap back to the live head.
				//     Resuming resets navigation to the board list (live, no banner). ---
				await run(tui, ':peek now', 'peek now');
				const resumed = await tui.waitFor(
					output =>
						!output.includes('Readonly') &&
						output.includes('Default (3 issues)'),
					4_000,
				);
				expect(resumed).not.toContain('Readonly');
				expect(resumed).toContain('Default (3 issues)');

				// Re-enter the board: the live head has all three issues back, and a
				// BOARD is in the breadcrumb for the offset check below.
				tui.input(ENTER);
				const reentered = await tui.waitFor(
					output =>
						output.includes('Todo (3)') && output.includes('Third issue'),
					4_000,
				);
				expect(reentered).toContain('Third issue');

				// --- Absolute date peek (YYYY-MM-DD). A date past all activity yields
				//     a read-only snapshot with every event applied so far. Use a date
				//     a year out so it sits comfortably after the board's creation. ---
				const future = new Date();
				future.setFullYear(future.getFullYear() + 1);
				const pad = (n: number) => String(n).padStart(2, '0');
				const futureDate = `${future.getFullYear()}-${pad(
					future.getMonth() + 1,
				)}-${pad(future.getDate())}`;

				await run(tui, `:peek ${futureDate}`, `peek ${futureDate}`);
				const dateSnapshot = await tui.waitFor(
					output =>
						output.includes('Readonly') &&
						output.includes('Todo (3)') &&
						output.includes('First issue') &&
						output.includes('Second issue') &&
						output.includes('Third issue'),
					4_000,
				);
				expect(dateSnapshot).toContain('Readonly');
				expect(dateSnapshot).toContain('Third issue');

				// Resume live and re-enter the board so a BOARD is in the breadcrumb
				// for the offset check below.
				await run(tui, ':peek now', 'peek now');
				await tui.waitFor(
					output =>
						!output.includes('Readonly') &&
						output.includes('Default (3 issues)'),
					4_000,
				);
				tui.input(ENTER);
				await tui.waitFor('Todo (3)', 4_000);

				// --- Relative offset (e.g. `2y`). In a freshly created project every
				//     offset resolves to before the board existed, so the command is
				//     rejected with a guard message rather than executing. ---
				tui.input(':peek 2y');
				const guarded = await tui.waitFor(
					output =>
						output.includes('peek 2y') &&
						output.includes('nothing to peek before'),
					4_000,
				);
				expect(guarded).toContain('nothing to peek before');

				// Abandon the rejected command; the live board is untouched.
				tui.input(ESCAPE);
				await tui.waitFor(EMPTY_CMD, 4_000);
				const stillLive = await tui.waitFor(
					output => !output.includes('Readonly') && output.includes('Todo (3)'),
					4_000,
				);
				expect(stillLive).not.toContain('Readonly');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
