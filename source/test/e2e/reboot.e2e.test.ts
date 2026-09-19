import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {readCommandHistory} from '../../lib/config/command-history.js';
import {isSuccess} from '../../lib/model/result-types.js';
import {commonSteps, fileIssue} from './e2e-common-steps.js';
import {
	ENTER,
	recallFromHistory,
	removeTempRepo,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;

/**
 * Waits until a command has reached the history on disk.
 *
 * The history is written as the command is confirmed, which is after the
 * command has run and the board has drawn its result — so a process killed
 * straight off that frame can beat its own write, and the next boot then
 * hydrates a history missing the last thing that was run (`YTPEXEF`).
 *
 * Stored without the colon: the sigil opens the line, and what the line holds
 * is the command itself.
 */
const storedHistoryHas = async (root: string, command: string) => {
	let last = 'nothing read';

	// The same 20s the other steps in this suite allow: the write trails the
	// command's own work, which is git, and under a full container that is
	// seconds rather than milliseconds after the board has drawn the result.
	for (let waited = 0; waited < 20_000; waited += 100) {
		const stored = readCommandHistory({root});

		if (isSuccess(stored)) {
			if (stored.value.includes(command)) return;
			last = JSON.stringify(stored.value);
		} else {
			last = stored.message;
		}

		await new Promise(resolve => setTimeout(resolve, 100));
	}

	throw new Error(
		`The stored command history never gained ${command}. It holds: ${last}`,
	);
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		await tui.destroy();
	}
});

describe('TUI reboot / event-log replay e2e', () => {
	it(
		'replays the persisted event log after a full app reboot and can append onto it',
		async () => {
			// A stable working directory shared by both app processes. The event
			// log is keyed off the project id stored under this directory, so a
			// second process rebooted here must replay exactly what the first wrote.
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-reboot-'));

			try {
				// --- First process: create a project and a couple of issues. ---
				const first = setupTui([], {cwd});

				try {
					await commonSteps.init(first);

					first.input(ENTER);
					await first.waitFor('Todo (0)');

					// Both filed through the shared step, which waits on the lane's
					// count: the typed command is echoed in the command line, so a
					// wait on the two titles alone comes true while the second one is
					// still being typed — and the history the reboot below walks
					// would then be missing the command that was never submitted.
					await fileIssue(first, 'Persisted issue one', 1);
					await fileIssue(first, 'Persisted issue two', 2);

					const created = first.output();

					expect(created).toContain('Persisted issue one');
					expect(created).toContain('Persisted issue two');

					// Both commands on disk before the process goes, since the recall
					// below is a walk through exactly this history.
					await storedHistoryHas(cwd, 'new issue Persisted issue one');
					await storedHistoryHas(cwd, 'new issue Persisted issue two');
				} finally {
					// Ctrl-C + kill the process. The cwd is preserved (caller-owned).
					await first.destroy();
				}

				// --- Second process: a brand new boot in the same directory. ---
				const second = setupTui([], {cwd});

				try {
					// An existing project boots with navigation restored straight to
					// the swimlane view, rather than the "Initialize project" prompt.
					// Both issues were reconstructed purely from the replayed log.
					const replayed = await second.waitFor(
						output =>
							output.includes('Persisted issue one') &&
							output.includes('Persisted issue two'),
						8_000,
					);

					expect(replayed).toContain('Persisted issue one');
					expect(replayed).toContain('Persisted issue two');

					// The replayed log is still live: we can append a new event onto
					// it. Filed through the shared step, which waits on the lane's
					// count and re-sends a dropped submit: the typed command is
					// echoed in the command line, title and all, so a wait on the
					// title alone came true before Enter had been handled — and
					// everything below then ran against a board of two issues and a
					// history that had not gained the command yet (`YTPEXEF`).
					await fileIssue(second, 'Issue after reboot', 3);

					const appended = await second.waitFor(
						output =>
							output.includes('Issue after reboot') &&
							output.includes('Persisted issue one') &&
							output.includes('Persisted issue two'),
					);

					expect(appended).toContain('Issue after reboot');
					expect(appended).toContain('Persisted issue one');
					expect(appended).toContain('Persisted issue two');

					// The command line's own history outlived the first process too:
					// ↑ on a fresh boot reaches back past it. The colon gets a write
					// and a frame of its own, since keys in one chunk are handled
					// before the mode has changed.
					//
					// Waited for on the topbar rather than in the command line, which
					// cannot answer this one. An empty line is drawn as the colon
					// followed by its completions — `:  ...  new  tag  edit` — and the
					// idle shortcut bar opens `: write command`, so both wear a colon
					// and a space. `commandLineShows(':')` only matches in the instant
					// after the keystroke and before the completions paint, which is a
					// race the gate loses under load.
					// Walked rather than pressed step by step: an arrow's escape
					// sequence reaching the TUI in pieces closes the command line, and
					// the walk starts over — see `recallFromHistory` (`YTPEXEF`).
					const [recalled] = await recallFromHistory(second, [
						':new issue Issue after reboot',
						':new issue Persisted issue two',
					]);

					expect(recalled).toContain('Issue after reboot');
				} finally {
					await second.destroy();
				}
			} finally {
				removeTempRepo(cwd);
			}
		},
		testTimeout,
	);
});
