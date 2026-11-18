import {describe, expect, it} from 'vitest';
import {commonSteps, fileIssue, typeCommand} from './e2e-common-steps.js';
import {commandLineShows, ENTER, setupTui} from './e2e.helper.js';

// Leaving the TUI: `q` steps out to the board list, and there offers `exit`.
// `:q` and its kin quit from anywhere.

const testTimeout = 90_000;
const quits = (tui: ReturnType<typeof setupTui>) =>
	Promise.race([
		tui.exited.then(() => true),
		new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10_000)),
	]);

describe('quit', () => {
	it(
		'q at the board list offers exit, and enter quits',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.configureInitialSettings(tui, 'off');
				await commonSteps.init(tui);

				// Into the board, then back out to the list, where nothing is above.
				tui.input(ENTER);
				await tui.waitFor('Default ▸ Todo', 10_000);
				tui.input('q');
				await tui.waitFor('Select a board', 10_000);
				tui.input('q');
				await tui.waitFor(
					frame =>
						commandLineShows('exit')(frame) &&
						frame.includes('exit the application'),
					10_000,
				);

				tui.input(ENTER);
				expect(await quits(tui)).toBe(true);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	// The rest of the aliases parse the same way (command-parser.test.ts).
	it(
		':q! quits from the board',
		async () => {
			const tui = setupTui();

			try {
				// Setup is done: the first test answered it for this file's HOME.
				await commonSteps.init(tui);

				await typeCommand(tui, ':q!');
				expect(await quits(tui)).toBe(true);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		':quit quits while peeking, which is read-only',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);
				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 10_000);
				await fileIssue(tui, 'First issue', 1);

				await typeCommand(tui, ':peek prev');
				await tui.waitFor('Readonly', 10_000);

				await typeCommand(tui, ':quit');
				expect(await quits(tui)).toBe(true);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
