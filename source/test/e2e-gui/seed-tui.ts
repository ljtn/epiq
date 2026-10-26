import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import pty from 'node-pty';

// A minimal pty driver: the vitest helper's @xterm/headless import only resolves under vitest.

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

	// Ink renders only the final frame under CI, so the CI variables are stripped.
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

	// ENTER is a separate write after the prompt asks for it, or it is dropped.
	const pause = () => new Promise(resolve => setTimeout(resolve, 200));

	/**
	 * Clears the prefilled command line, then types a command. Backspace, not
	 * escape: a lone escape merges with the next key into an alt keypress.
	 */
	const command = async (value: string) => {
		tui.input('\x7f'.repeat(60));
		await pause();
		tui.input(value);
		await tui.waitFor('<ENTER> to confirm');
		tui.input('\r');
	};

	await tui.waitFor('choose your username');
	// The slash is deliberate: file names cannot hold one, so a name read off a file differs.
	await command(':config username claude/tester');

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
	await command(':init');

	// Declined: a claimed address would change every test's commit track.
	await tui.waitFor('Claim the git addresses');
	await command(':config emails none');

	await tui.waitFor('Default');

	// A second board, so the switcher has somewhere to switch to.
	await command(':new board QA');
	// The typed command already shows "QA", so forget the buffer before waiting.
	tui.forget();
	await tui.waitFor('QA');

	tui.destroy();

	return tui.cwd;
};
