import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';
const ESCAPE = '\x1B';

type Tui = ReturnType<typeof setupTui>;

// The global epiq config lives under os.homedir(), which every e2e session
// otherwise shares. Parallel files all writing that one config.json race, and a
// session can read it mid-write and drop back to first-run setup. We give this
// file its own HOME so it neither suffers nor contributes to that race, and
// supply a git identity (the isolated HOME has no ~/.gitconfig).
const E2E_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-home-'));

// A non-interactive editor stand-in: `epiq` expands `$EDITOR` through the shell
// at edit time, so registering `$EDITOR` and pointing it here makes
// `edit description` deterministic instead of blocking on a real editor.
const fakeEditor = path.resolve(
	process.cwd(),
	'source/test/e2e/fake-editor.sh',
);
const EDITED_DESCRIPTION = 'Implemented during the e2e flow';

const ENV = {
	HOME: E2E_HOME,
	EDITOR: fakeEditor,
	GIT_AUTHOR_NAME: 'Epiq E2E',
	GIT_AUTHOR_EMAIL: 'e2e@example.com',
	GIT_COMMITTER_NAME: 'Epiq E2E',
	GIT_COMMITTER_EMAIL: 'e2e@example.com',
};

// Run a command-line command and wait for it to fully settle (see lifecycle).
const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

// Type a partial command and assert the inline autocompletion completes it.
// The completion renders as ghost text right after the cursor, so the rendered
// line reads as the fully completed command even though only the prefix was
// typed. We assert against the colon-prefixed command line so unrelated on-
// screen text (e.g. the "press e to edit" label) cannot match. ESC resets.
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
	const tui = setupTui([], {env: ENV});

	try {
		await tui.waitFor('choose your username', 8_000);
		tui.input(':config username test\r');

		await tui.waitFor('pick your editor');
		tui.input(':config editor vim\r');

		await tui.waitFor('Configure auto sync');
		// Off: this file only exercises command autocompletion, and disabling
		// autosync avoids any background git work.
		tui.input(':config autoSync off\r');

		await tui.waitFor('Initialize project', 8_000);
	} finally {
		tui.destroy();
	}
});

afterAll(() => {
	fs.rmSync(E2E_HOME, {recursive: true, force: true});
});

describe('TUI edit-command scope e2e', () => {
	it(
		'autocompletes `edit` whenever an issue or a descendant is selected',
		async () => {
			const tui = setupTui([], {env: ENV});

			try {
				// Init a fresh project in this session's own temp cwd.
				execSync('git init', {cwd: tui.cwd, stdio: 'ignore'});
				await tui.waitFor('Initialize project', 8_000);
				tui.input(':init');
				await tui.waitFor('<ENTER> to confirm', 8_000);
				tui.input('\r');
				await tui.waitFor('Default (0 issues)', 8_000);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// Register the deterministic editor stand-in for description edits.
				await run(tui, ':config editor $EDITOR', 'config editor $EDITOR');

				// The freshly created issue becomes the selected node.
				await run(tui, ':new issue Scope test', 'new issue Scope test');
				await tui.waitFor('Todo (1)', 4_000);

				// 1. Issue itself selected: both the `edit` command (first word) and
				//    its `description` modifier must autocomplete.
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

				// 3. Actually run it: from a descendant selection, `edit description`
				//    must edit the in-scope ticket's description. The stand-in editor
				//    writes a fixed value, which should then render in the field.
				await run(tui, ':edit description', 'edit description');
				await tui.waitFor(EDITED_DESCRIPTION, 8_000);
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
