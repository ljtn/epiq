import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {
	commandLineShows,
	ENTER,
	removeTempRepo,
	setupTui,
} from './e2e.helper.js';

// Setup is this machine's; a project is the repository's. Finishing setup asks
// whether to start one here rather than starting it.

const testTimeout = 90_000;
const ESC = '\x1B';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-setup-'));
execSync('git init', {cwd: repo, stdio: 'ignore'});

afterAll(() => removeTempRepo(repo));

describe('setup', () => {
	it(
		'hands over to init in a git repository with no board, and enter starts one',
		async () => {
			const tui = setupTui([], {cwd: repo});

			try {
				await tui.waitFor('choose your username', 20_000);
				await typeCommand(tui, ':config username test');
				await tui.waitFor('pick your editor', 20_000);
				await typeCommand(tui, ':config editor vim');
				await tui.waitFor('Configure auto sync', 20_000);
				await typeCommand(tui, ':config autoSync off');

				const handover = await tui.waitFor(
					frame =>
						frame.includes('Setup complete!') &&
						frame.includes('Do you want to start one here?') &&
						commandLineShows('init')(frame),
					20_000,
				);
				expect(handover).toContain('to skip');

				tui.input(ENTER);
				await commonSteps.declineEmails(tui);
				await tui.waitFor('Default (0 issues)', 20_000);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'`epiq setup` asks again, each answer held, and leaves the board as it was',
		async () => {
			const tui = setupTui(['setup'], {cwd: repo});

			try {
				await tui.waitFor(
					frame =>
						frame.includes('Esc leaves setup') &&
						commandLineShows('config username test')(frame),
					20_000,
				);

				tui.input(ENTER);
				await tui.waitFor(commandLineShows('config editor vim'), 20_000);
				tui.input(ENTER);
				await tui.waitFor(commandLineShows('config autoSync off'), 20_000);
				tui.input(ENTER);

				// The repository already has its board: no question, just the board.
				const board = await tui.waitFor('Todo (0)', 20_000);
				expect(board).not.toContain('Setup complete!');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'esc leaves a rerun without asking the rest',
		async () => {
			const tui = setupTui([], {cwd: repo});

			try {
				await tui.waitFor('Todo (0)', 20_000);
				await typeCommand(tui, ':setup');
				await tui.waitFor(commandLineShows('config username test'), 20_000);

				tui.input(ESC);
				await tui.waitFor(
					frame =>
						frame.includes('Todo (0)') && !frame.includes('Esc leaves setup'),
					20_000,
				);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'outside a git repository says so rather than offering init',
		async () => {
			const tui = setupTui(['setup']);

			try {
				await tui.waitFor(commandLineShows('config username test'), 20_000);
				tui.input(ENTER);
				await tui.waitFor(commandLineShows('config editor vim'), 20_000);
				tui.input(ENTER);
				await tui.waitFor(commandLineShows('config autoSync off'), 20_000);
				tui.input(ENTER);

				const screen = await tui.waitFor('not a git repository', 20_000);
				expect(screen).toContain('Setup complete!');
				expect(screen).not.toContain('to skip');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
