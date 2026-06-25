import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';
const ESCAPE = '\x1B';

type Tui = ReturnType<typeof setupTui>;

// Run a command-line command and wait for it to fully settle (see lifecycle).
const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

// Type a partial command and assert the inline autocompletion completes it.
// The completion is rendered as ghost text right after the cursor, so the
// rendered line reads as the fully completed command even though only the
// prefix was typed. We then ESC out so the next assertion starts clean.
const expectAutocompletes = async (
	tui: Tui,
	partial: string,
	completedLine: string,
) => {
	tui.input(partial);
	const output = await tui.waitFor(
		screen => screen.includes(completedLine),
		4_000,
	);
	expect(output).toContain(completedLine);
	tui.input(ESCAPE);
	await tui.waitFor(EMPTY_CMD, 4_000);
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
	}
});

describe('TUI edit-command scope e2e', () => {
	it(
		'autocompletes `edit` whenever an issue or a descendant is selected',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// The freshly created issue becomes the selected node.
				await run(tui, ':new issue Scope test', 'new issue Scope test');
				await tui.waitFor('Todo (1)', 4_000);

				// 1. Issue itself selected: both the `edit` command (first word) and
				//    its `description` modifier must autocomplete. We assert against
				//    the colon-prefixed command line so the static "press e to edit"
				//    label in the detail view below cannot produce a false positive.
				await expectAutocompletes(tui, ':edi', ':edit');
				await expectAutocompletes(tui, ':edit des', ':edit description');

				// Enter the issue so the selection becomes a descendant (a virtual
				// field), not the ticket node itself.
				tui.input(ENTER);
				await tui.waitFor('History ››', 4_000);

				// 2. Descendant selected: `edit` and `edit description` must still
				//    autocomplete, even though the selected node's own context is not
				//    a ticket.
				await expectAutocompletes(tui, ':edi', ':edit');
				await expectAutocompletes(tui, ':edit des', ':edit description');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
