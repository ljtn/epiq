import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	removeTempRepo,
	setupTui,
} from './e2e.helper.js';

// Setup is this machine's; a project is the repository's. `epiq setup` quits
// with its own questions; opening a repository with no board offers one.

const testTimeout = 90_000;
const ESC = '\x1B';

const quits = (tui: ReturnType<typeof setupTui>) =>
	Promise.race([
		tui.exited.then(() => true),
		new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10_000)),
	]);

const gitRepo = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-setup-'));
	execSync('git init', {cwd: dir, stdio: 'ignore'});
	return dir;
};

const repo = gitRepo();
// The name setup proposes on a first run.
execSync('git config user.name test', {cwd: repo, stdio: 'ignore'});
const boardless = gitRepo();

afterAll(() => {
	removeTempRepo(repo);
	removeTempRepo(boardless);
});

describe('setup', () => {
	it(
		'a first run opens on the git name, asks no editor, and ends on the offer of a board',
		async () => {
			const tui = setupTui([], {cwd: repo});

			try {
				await tui.waitFor(
					frame =>
						frame.includes('the name others see on the board') &&
						commandLineShows('config username test')(frame),
					20_000,
				);
				tui.input(ENTER);

				const sync = await tui.waitFor(
					frame =>
						frame.includes('Auto sync keeps the board current') &&
						commandLineShows('config autoSync on')(frame),
					20_000,
				);
				expect(sync).not.toContain('editor');
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
		'`epiq setup` asks again, each answer held, and quits',
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
				await tui.waitFor(commandLineShows('config autoSync off'), 20_000);
				tui.takeWritten();
				tui.input(ENTER);

				expect(await quits(tui)).toBe(true);
				expect(tui.takeWritten()).toContain("You're all set.");
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

				// Typing the command yourself is not the offer: the screen stays put.
				// A key right after ESC can be lost: retry until the line opens.
				await tui.waitFor(commandLineIsIdle, 20_000);
				for (let attempt = 0; attempt < 10; attempt++) {
					tui.input(':');
					const opened = await tui
						.waitFor(frame => frame.includes('Mode: cmd-line'), 1_000)
						.then(() => true)
						.catch(() => false);
					if (opened) break;
				}

				tui.input('init');
				const typed = await tui.waitFor(commandLineShows('init'), 20_000);
				expect(typed).toContain('Initialize project');
				expect(typed).not.toContain('Do you want to start one here?');
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
		'`epiq setup` in a repository with no board quits without offering one',
		async () => {
			const tui = setupTui(['setup'], {cwd: boardless});

			try {
				await tui.waitFor(commandLineShows('config username test'), 20_000);
				tui.input(ENTER);
				await tui.waitFor(commandLineShows('config autoSync off'), 20_000);
				tui.takeWritten();
				tui.input(ENTER);

				expect(await quits(tui)).toBe(true);
				expect(tui.takeWritten()).not.toContain('Do you want');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
