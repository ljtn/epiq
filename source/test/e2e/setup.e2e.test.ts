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

// Setup is this machine's; a project is the repository's. Setup ends with its
// own questions, and a repository with no board offers one, whatever led there.

const testTimeout = 90_000;
const ESC = '\x1B';

const gitRepo = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-setup-'));
	execSync('git init', {cwd: dir, stdio: 'ignore'});
	return dir;
};

const repo = gitRepo();
const boardless = gitRepo();

afterAll(() => {
	removeTempRepo(repo);
	removeTempRepo(boardless);
});

describe('setup', () => {
	it(
		'ends on the offer of a board in a git repository with none, and enter starts one',
		async () => {
			const tui = setupTui([], {cwd: repo});

			try {
				await tui.waitFor('choose your username', 20_000);
				await typeCommand(tui, ':config username test');
				await tui.waitFor('pick your editor', 20_000);
				await typeCommand(tui, ':config editor vim');
				await tui.waitFor('Configure auto sync', 20_000);
				await typeCommand(tui, ':config autoSync off');

				const offer = await tui.waitFor(
					frame =>
						frame.includes('Do you want to start one here?') &&
						commandLineShows('init')(frame),
					20_000,
				);
				expect(offer).toContain('to skip');

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
				expect(board).not.toContain('Do you want to start one here?');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'a rerun ends on another setting rather than skip the step asked',
		async () => {
			const tui = setupTui([], {cwd: repo});

			try {
				await tui.waitFor('Todo (0)', 20_000);
				await typeCommand(tui, ':setup');
				await tui.waitFor(commandLineShows('config username test'), 20_000);

				await typeCommand(tui, ':config editor vim');
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
		'a repository with no board offers one on opening, and esc leaves the instruction',
		async () => {
			const tui = setupTui([], {cwd: boardless});

			try {
				await tui.waitFor(
					frame =>
						frame.includes('Do you want to start one here?') &&
						commandLineShows('init')(frame),
					20_000,
				);

				tui.input(ESC);
				const skipped = await tui.waitFor(
					frame =>
						frame.includes(':init') &&
						!frame.includes('Do you want to start one here?'),
					20_000,
				);
				expect(skipped).toContain('Initialize project');
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
				expect(screen).not.toContain('to skip');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
