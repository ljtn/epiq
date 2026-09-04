import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = commandLineIsIdle;

// Writes a description longer and wider than the box, so both edges have to
// hold (see fake-editor-long.sh).
const fakeEditor = path.resolve(
	process.cwd(),
	'source/test/e2e/fake-editor-long.sh',
);

type Tui = ReturnType<typeof setupTui>;

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

// The description box, as its border draws it: the top row, the rows between,
// and the bottom row.
const descriptionBox = (frame: string) => {
	const lines = frame.split('\n').map(line => line.trimEnd());
	const top = lines.findIndex(line => line.trimStart().startsWith('╭'));
	const bottom = lines.findIndex(
		(line, index) => index > top && line.trimStart().startsWith('╰'),
	);

	return {
		top: lines[top] ?? '',
		bottom: lines[bottom] ?? '',
		inside: lines.slice(top + 1, bottom),
	};
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		await tui.destroy();
	}
});

describe('TUI description box', () => {
	// The rows were measured against more room than the box has, in both
	// directions: a row wider than the box wrapped onto a second terminal line,
	// and the box was handed more rows than its border could draw. Either way
	// the description ended up written over the bottom border.
	it(
		'keeps a description that is too long and too wide inside its border',
		async () => {
			const tui = setupTui([], {env: {EDITOR: fakeEditor}});

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				await run(tui, ':config editor $EDITOR', 'config editor $EDITOR');
				await run(tui, ':new issue Long description', 'new issue Long');
				await tui.waitFor('Todo (1)', 4_000);
				await run(tui, ':edit description', 'edit description');

				tui.input(ENTER);
				await tui.waitFor('Description (press e to edit)', 4_000);

				const {top, bottom, inside} = descriptionBox(tui.output());

				// Nothing but border on the row that closes the box.
				expect(bottom.trimStart()).toMatch(/^╰─+╯$/);

				// And every row between the borders is one row, closed on both
				// sides — a wrapped row would leave a line with no border.
				expect(inside.length).toBeGreaterThan(0);
				for (const line of inside) {
					expect(line.trimStart()).toMatch(/^│.*│$/);
					expect(line.length).toBe(top.length);
				}
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
