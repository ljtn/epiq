import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ARROW_DOWN, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';

type Tui = ReturnType<typeof setupTui>;

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
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

				// Into the ticket, down to its Comments field, and in.
				tui.input(ENTER);
				await tui.waitFor('Comments (1) ››', 4_000);
				// Description, Assignees, Tags, History come first; stop on Comments.
				for (let step = 0; step < 6; step++) {
					if (/❯\s+Comments \(1\)/.test(tui.output())) break;
					tui.input(ARROW_DOWN);
					await new Promise(resolve => setTimeout(resolve, 150));
				}
				await tui.waitFor(/❯\s+Comments \(1\)/, 4_000);
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
