import {beforeAll, describe, it} from 'vitest';
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

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		await tui.destroy();
	}
});

describe('TUI lane rules e2e', () => {
	it(
		'marks the selected lane done beside the lane called Done, and takes the rule off again',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				// Done counts by its name.
				tui.input(ENTER);
				await tui.waitFor(
					output =>
						output.includes('Done (0) ✓') && !output.includes('Todo (0) ✓'),
					4_000,
				);

				// Marked, Todo counts beside it.
				await run(tui, ':rule done', 'rule done');
				await tui.waitFor(
					output =>
						output.includes('Todo (0) ✓') && output.includes('Done (0) ✓'),
					4_000,
				);

				await run(tui, ':unrule done', 'unrule done');
				await tui.waitFor(
					output =>
						output.includes('Done (0) ✓') && !output.includes('Todo (0) ✓'),
					4_000,
				);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
