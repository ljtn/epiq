import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;

type Tui = ReturnType<typeof setupTui>;

// Typed, echoed, submitted and settled before the next command, or the
// keystrokes merge into one un-submitted line.
const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(commandLineIsIdle, 5_000);
};

// A compact row marks a ticket in a goal with ◆ at its end.
const marked = (output: string, title: string) =>
	output.split('\n').some(line => line.includes(title) && line.includes('◆'));

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		await tui.destroy();
	}
});

describe('TUI goals e2e', () => {
	it(
		'names a goal, joins it by name, leaves it, and filters the board to it',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// A new issue is the selection, so `:goal` right after applies to it.
				await run(tui, ':new issue Alpha', 'new issue Alpha');
				await run(tui, ':goal Launch', 'goal Launch');
				await tui.waitFor(output => marked(output, 'Alpha'), 4_000);

				// Any case finds the goal already made.
				await run(tui, ':new issue Beta', 'new issue Beta');
				await run(tui, ':goal launch', 'goal launch');
				await tui.waitFor(output => marked(output, 'Beta'), 4_000);

				await run(tui, ':ungoal', 'ungoal');
				await tui.waitFor(
					output => marked(output, 'Alpha') && !marked(output, 'Beta'),
					4_000,
				);
				await run(tui, ':goal Launch', 'goal Launch');
				await tui.waitFor(output => marked(output, 'Beta'), 4_000);

				await run(tui, ':new issue Gamma', 'new issue Gamma');
				await tui.waitFor('Todo (3)', 4_000);

				await run(tui, ':filter goal Launch', 'filter goal Launch');
				const narrowed = await tui.waitFor(
					output =>
						output.includes('APPLIED FILTERS:') &&
						output.includes('Alpha') &&
						output.includes('Beta') &&
						!output.includes('Gamma'),
					4_000,
				);
				expect(marked(narrowed, 'Alpha') && marked(narrowed, 'Beta')).toBe(
					true,
				);

				await run(tui, ':filter clear', 'filter clear');
				await tui.waitFor(
					output =>
						output.includes('Gamma') && !output.includes('APPLIED FILTERS:'),
					4_000,
				);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
