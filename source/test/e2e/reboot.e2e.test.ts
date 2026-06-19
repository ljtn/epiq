import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
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

					first.input(':new issue Persisted issue one', ENTER);
					await first.waitFor('Todo (1)');

					first.input(':new issue Persisted issue two', ENTER);
					const created = await first.waitFor(
						output =>
							output.includes('Persisted issue one') &&
							output.includes('Persisted issue two'),
					);

					expect(created).toContain('Persisted issue one');
					expect(created).toContain('Persisted issue two');
				} finally {
					// Ctrl-C + kill the process. The cwd is preserved (caller-owned).
					first.destroy();
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

					// The replayed log is still live: we can append a new event onto it.
					second.input(':new issue Issue after reboot', ENTER);
					const appended = await second.waitFor(
						output =>
							output.includes('Issue after reboot') &&
							output.includes('Persisted issue one') &&
							output.includes('Persisted issue two'),
					);

					expect(appended).toContain('Issue after reboot');
					expect(appended).toContain('Persisted issue one');
					expect(appended).toContain('Persisted issue two');
				} finally {
					second.destroy();
				}
			} finally {
				fs.rmSync(cwd, {recursive: true, force: true});
			}
		},
		testTimeout,
	);
});
