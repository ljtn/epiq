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

	const child = pty.spawn(process.execPath, [cliPath], {
		name: 'xterm-color',
		cols: 200,
		rows: 50,
		cwd,
		env: {
			...process.env,
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

	await tui.waitFor('choose your username');
	tui.input(':config username test\r');

	await tui.waitFor('pick your editor');
	tui.input(':config editor vim\r');

	await tui.waitFor('Configure auto sync');
	// Off: an autosync tick mid-test would change state no assertion asked for.
	tui.input(':config autoSync off\r');

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
	await tui.waitFor('QA');

	tui.destroy();

	return tui.cwd;
};
