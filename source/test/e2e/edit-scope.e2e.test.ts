import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	removeTempRepo,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;
const ESCAPE = '\x1B';

type Tui = ReturnType<typeof setupTui>;

// Its own HOME, so parallel files don't race on one global config.json; the
// isolated HOME needs its own git identity.
const E2E_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-home-'));

// A non-interactive `$EDITOR` stand-in, so `edit description` doesn't block.
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
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(commandLineIsIdle, 5_000);
};

// Types a prefix and asserts the ghost-text completion on the colon-prefixed
// command line, so unrelated screen text can't match. ESC resets.
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
	await tui.waitFor(commandLineIsIdle, 4_000);
};

beforeAll(async () => {
	const tui = setupTui([], {env: ENV});

	try {
		// Autosync off: this file tests autocompletion only.
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

afterAll(() => {
	removeTempRepo(E2E_HOME);
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
				await typeCommand(tui, ':init');
				await commonSteps.declineEmails(tui);
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

				// 2. Descendant selected: `edit` and `edit description` still autocomplete.
				await expectAutocompletes(tui, ':edi', ':edit');
				await expectAutocompletes(tui, ':edit des', ':edit description');

				// 3. From a descendant, `edit description` edits the in-scope ticket;
				//    the stand-in editor writes a fixed value.
				await run(tui, ':edit description', 'edit description');
				await tui.waitFor(EDITED_DESCRIPTION, 8_000);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
