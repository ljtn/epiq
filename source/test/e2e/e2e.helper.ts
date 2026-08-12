import {Terminal} from '@xterm/headless';
import pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const width = 120;
const height = 20;

export const ENTER = '\r';
export const ARROW_DOWN = '\x1B\x5B\x42';
export const ARROW_UP = '\x1B\x5B\x41';
export const ARROW_RIGHT = '\x1B\x5B\x43';
export const ARROW_LEFT = '\x1B\x5B\x44';

const MOVE_CURSOR_HOME = '\x1B[H';
const CLEAR_SCREEN = '\x1B[2J';
const HIDE_CURSOR = '\x1B[?25l';
const SHOW_CURSOR = '\x1B[?25h';

let lastLoggedOutput = '';

const logFrame = (output: string) => {
	if (output === lastLoggedOutput) return;

	lastLoggedOutput = output;

	process.stdout.write(
		HIDE_CURSOR + MOVE_CURSOR_HOME + CLEAR_SCREEN + output + SHOW_CURSOR,
	);
};

type TuiSession = {
	cwd: string;
	input: (...values: string[]) => void;
	output: () => string;
	waitFor: (
		text: string | RegExp | ((output: string) => boolean),
		timeoutMs?: number,
	) => Promise<string>;
	clear: () => void;
	destroy: () => void;
};

// Isolated per test file (vitest forks/isolates each file into its own
// process), so all `setupTui()` calls in one file share this global dir, but
// concurrently-running files never touch each other's real or simulated
// `~/.epiq-global`. Without this, every e2e process shared the developer's
// or CI runner's actual `~/.epiq-global`, so parallel files raced on the same
// global config/worktrees — the likely cause of the flaky ":init" timing and
// stray "not an epiq project yet" failures under CI load. Deliberately does
// NOT override HOME itself: git/ssh still need the real `~/.gitconfig` (user
// identity) to create commits.
const isolatedGlobalDir = fs.mkdtempSync(
	path.join(os.tmpdir(), 'epiq-e2e-global-'),
);

// Set on the worker's own env (not just the spawned TUI child's) so test
// files that call epiq-api.js functions directly in-process — e.g. to
// inspect state a TUI session just wrote — see the same isolated global dir.
process.env['EPIQ_GLOBAL_DIR'] = isolatedGlobalDir;

const createTuiEnv = (extra: Record<string, string> = {}) => {
	const env = {...process.env};

	delete env['CI'];
	delete env['GITHUB_ACTIONS'];

	return {
		...env,
		TERM: 'xterm-256color',
		FORCE_COLOR: '1',
		...extra,
	};
};

const sleep = async (ms: number) =>
	await new Promise(resolve => setTimeout(resolve, ms));

type SetupTuiOptions = {
	/**
	 * The caller owns the directory: it is left in place on
	 * `destroy()` so a follow-up session can replay the persisted event log.
	 */
	cwd?: string;
	/** Extra environment variables for the spawned process (e.g. EDITOR). */
	env?: Record<string, string>;
};

export const setupTui = (
	args: string[] = [],
	options: SetupTuiOptions = {},
): TuiSession => {
	const ownsCwd = options.cwd === undefined;
	const cwd =
		options.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-'));
	const cliPath = path.resolve(process.cwd(), 'dist/index.js');

	let destroyed = false;
	let renderedOutput = '';
	let pendingWrites: Promise<void> = Promise.resolve();

	const terminal = new Terminal({
		cols: width,
		rows: height,
		allowProposedApi: true,
	});

	const child = pty.spawn(process.execPath, [cliPath, ...args], {
		name: 'xterm-256color',
		cols: width,
		rows: height,
		cwd,
		env: createTuiEnv(options.env),
	});

	const renderOutput = () => {
		const lines: string[] = [];

		for (let i = 0; i < height; i++) {
			lines.push(
				terminal.buffer.active.getLine(i)?.translateToString(true) ?? '',
			);
		}

		renderedOutput = lines
			.map(line => line.padEnd(width, ' ').slice(0, width))
			.join('\n');

		logFrame(renderedOutput);
	};

	const flushOutput = async () => {
		await pendingWrites;
		renderOutput();
	};

	child.onData(data => {
		pendingWrites = pendingWrites.then(
			() =>
				new Promise<void>(resolve => {
					terminal.write(data, () => {
						renderOutput();
						resolve();
					});
				}),
		);
	});

	const getOutput = () => renderedOutput;

	const clearOutput = () => {
		terminal.reset();
		renderOutput();
	};

	const destroy = () => {
		if (destroyed) return;
		destroyed = true;

		try {
			child.write('\x03');
			child.kill();
		} catch {
			// noop
		}

		if (ownsCwd) {
			fs.rmSync(cwd, {recursive: true, force: true});
		}
	};

	return {
		cwd,

		input: (...values) => {
			for (const item of values) {
				child.write(item);
			}
		},

		output: getOutput,
		clear: clearOutput,

		waitFor: async (text, timeoutMs = 3_000) => {
			const startedAt = Date.now();

			while (Date.now() - startedAt < timeoutMs) {
				await flushOutput();

				const currentOutput = getOutput();

				if (
					typeof text === 'string'
						? currentOutput.includes(text)
						: text instanceof RegExp
						? text.test(currentOutput)
						: text(currentOutput)
				) {
					return currentOutput;
				}

				await sleep(1);
			}

			await flushOutput();
			return getOutput();
		},

		destroy,
	};
};
