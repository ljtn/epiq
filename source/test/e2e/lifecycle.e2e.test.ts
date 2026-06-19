import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ARROW_DOWN, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';

// `epiq` only accepts editors from a fixed allow-list, but `$EDITOR` is one of
// them and is expanded through the shell at edit time. So we register `$EDITOR`
// and point the env var at a deterministic, non-interactive stand-in that just
// writes a fixed description and exits (see fake-editor.sh).
const fakeEditor = path.resolve(
	process.cwd(),
	'source/test/e2e/fake-editor.sh',
);

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

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
	}
});

describe('TUI issue lifecycle e2e', () => {
	it(
		'records every lifecycle event in the closed issue log',
		async () => {
			const tui = setupTui([], {env: {EDITOR: fakeEditor}});

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// Use the deterministic editor stand-in for description edits.
				await run(tui, ':config editor $EDITOR', 'config editor $EDITOR');

				// 1. Create the issue.
				await run(tui, ':new issue Lifecycle issue', 'new issue Lifecycle');
				await tui.waitFor('Todo (1)', 4_000);

				// 2. Edit its description (the stand-in editor writes the content).
				await run(tui, ':edit description', 'edit description');

				// 3. Tag it.
				await run(tui, ':tag lifecycle', 'tag lifecycle');

				// 4. Assign it.
				await run(tui, ':assign alice', 'assign alice');

				// 5. Comment on it.
				await run(tui, ':comment Looks good to me', 'comment Looks good');

				// 6. Move it to Done: enter move mode (m), step right across two
				//    swimlanes with hjkl (Todo -> In progress -> Done), confirm (m).
				tui.input('m');
				await tui.waitFor('Mode: move', 3_000);
				tui.input('l');
				await tui.waitFor('In progress (1)', 3_000);
				tui.input('l');
				await tui.waitFor('Done (1)', 3_000);
				tui.input('m');
				await tui.waitFor('Mode: default', 3_000);

				// 7. Close it (requires explicit confirmation).
				await run(tui, ':close confirm', 'close confirm');
				await tui.waitFor('Done (0)', 4_000);

				// Navigate up to the board list (q exits one level at a time) and
				// open the read-only Closed board.
				tui.input('q');
				await tui.waitFor('Default ▸ Done', 3_000);
				tui.input('q');
				await tui.waitFor('Select a board', 3_000);

				tui.input(ARROW_DOWN);
				await tui.waitFor('❯ Closed (1 issues)', 3_000);
				tui.input(ENTER);
				await tui.waitFor('Closed (1)', 3_000);

				// Enter the closed issue, then open its event log.
				tui.input(ARROW_DOWN);
				tui.input(ENTER);
				tui.input(ENTER);
				await tui.waitFor('History ››', 4_000);

				tui.input(ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, ENTER);
				await tui.waitFor('Event log', 4_000);
				const log = await tui.waitFor(
					'Created with title "Lifecycle issue"',
					4_000,
				);
				const normalized = log.replace(/\s{2,}/g, ' ');

				// One line per lifecycle event.
				expect(normalized).toContain('Created with title "Lifecycle issue"');
				expect(normalized).toContain('Changed description');
				expect(normalized).toContain('Tagged with lifecycle');
				expect(normalized).toContain('Assigned to alice');
				expect(normalized).toContain('Commented');
				expect(normalized).toContain('Moved issue to Done');
				expect(normalized).toContain('Closed');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
