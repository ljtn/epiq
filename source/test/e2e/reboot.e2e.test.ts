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
 * Waits until a command reaches the history on disk, stored without its colon;
 * the write trails the frame showing the result.
 */
const storedHistoryHas = async (root: string, command: string) => {
	let last = 'nothing read';

	// 20s, like the suite's other steps: the write trails git work.
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
			// Shared by both processes, so the second replays exactly what the first wrote.
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-reboot-'));

			try {
				// --- First process: create a project and a couple of issues. ---
				const first = setupTui([], {cwd});

				try {
					await commonSteps.init(first);

					first.input(ENTER);
					await first.waitFor('Todo (0)');

					// Filed through the shared step, which waits on the lane count rather
					// than the echoed title.
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
					// An existing project boots straight to the swimlanes, both issues
					// replayed from the log.
					const replayed = await second.waitFor(
						output =>
							output.includes('Persisted issue one') &&
							output.includes('Persisted issue two'),
						8_000,
					);

					expect(replayed).toContain('Persisted issue one');
					expect(replayed).toContain('Persisted issue two');

					// The replayed log is still live: append onto it, through the
					// shared step that waits on the lane count.
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

					// Command history survives a reboot. Waited for on the topbar, since
					// an empty and an idle command line both read as a colon.
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
