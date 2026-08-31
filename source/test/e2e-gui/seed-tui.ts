import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import pty from 'node-pty';

// A deliberately minimal pty driver rather than the vitest e2e helper: that
// helper imports `{Terminal}` from @xterm/headless, a CJS package whose named
// exports only resolve under vitest's interop. Seeding needs to wait for text,
// not to render a terminal grid, so the raw stream is enough.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B[@-Z\\-_]/g;

export type SeedTui = {
	cwd: string;
	input: (value: string) => void;
	waitFor: (text: string, timeoutMs?: number) => Promise<void>;
	// Drops everything seen so far, so a `waitFor` after it can only be
	// satisfied by a frame drawn from here on.
	forget: () => void;
	destroy: () => void;
};

export const startSeedTui = (): SeedTui => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-gui-e2e-'));
	// Outside the repo, or the global dir itself becomes an uncommitted change
	// and `:init` refuses. HOME is left alone: git still needs ~/.gitconfig.
	const globalDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'epiq-gui-e2e-global-'),
	);
	const cliPath = path.resolve(process.cwd(), 'dist/index.js');

	// The in-process GUI server reads this too, so it must be on our own env.
	process.env['EPIQ_GLOBAL_DIR'] = globalDir;

	let output = '';

	// Ink stops rendering frame by frame when it detects CI and writes only the
	// final frame, on unmount — so on a CI runner the pty stays silent and every
	// `waitFor` here times out on empty output. The TUI e2e helper strips the
	// same two for the same reason.
	const env = {...process.env};
	delete env['CI'];
	delete env['GITHUB_ACTIONS'];

	const child = pty.spawn(process.execPath, [cliPath], {
		name: 'xterm-color',
		cols: 200,
		rows: 50,
		cwd,
		env: {
			...env,
			EPIQ_GLOBAL_DIR: globalDir,
			TERM: 'xterm-256color',
		} as Record<string, string>,
	});

	child.onData(data => {
		output += data.replace(ANSI, '');
	});

	return {
		cwd,
		input: value => child.write(value),
		waitFor: async (text, timeoutMs = 30_000) => {
			const deadline = Date.now() + timeoutMs;

			while (!output.includes(text)) {
				if (Date.now() > deadline) {
					throw new Error(
						`Timed out waiting for ${JSON.stringify(text)}.\n` +
							`Last 1200 chars:\n${output.slice(-1200)}`,
					);
				}

				await new Promise(resolve => setTimeout(resolve, 50));
			}
		},
		forget: () => {
			output = '';
		},
		destroy: () => {
			try {
				child.write('\x03');
				child.kill();
			} catch {
				// already gone
			}
		},
	};
};

export const seedProject = async (): Promise<string> => {
	const tui = startSeedTui();

	// ENTER is a separate write *and* waits for the prompt to ask for it. Sent
	// any earlier it lands before the command is committed and is dropped, which
	// hangs the seed on the next waitFor.
	const command = async (value: string) => {
		tui.input(value);
		await tui.waitFor('<ENTER> to confirm');
		tui.input('\r');
	};

	await tui.waitFor('choose your username');
	await command(':config username test');

	await tui.waitFor('pick your editor');
	await command(':config editor vim');

	await tui.waitFor('Configure auto sync');
	// Off: an autosync tick mid-test would change state no assertion asked for.
	await command(':config autoSync off');

	await tui.waitFor('Initialize project');

	execSync('git init', {cwd: tui.cwd, stdio: 'ignore'});
	await tui.waitFor('This folder is not an epiq project yet.');

	// ENTER must arrive as its own write, or it is handled before the command
	// is committed and the confirm is dropped.
	tui.input(':init');
	await tui.waitFor('<ENTER> to confirm');
	tui.input('\r');
	await tui.waitFor('Default');

	// A second board, so the switcher has somewhere to switch to.
	tui.input(':new board QA');
	await tui.waitFor('<ENTER> to confirm');
	tui.input('\r');
	// The command being typed is itself on screen, so "QA" is in the buffer
	// before ENTER is even sent. Without forgetting it first, this wait is
	// already satisfied and `destroy` can land before the board is written —
	// leaving a seeded repo whose switcher has nothing to switch to.
	tui.forget();
	await tui.waitFor('QA');

	tui.destroy();

	return tui.cwd;
};
