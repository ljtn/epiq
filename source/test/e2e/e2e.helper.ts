import {Terminal} from '@xterm/headless';
import pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each file drives real TUIs through ptys in temp repos of their own, under a
// global dir of its own, so files run side by side.
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
	destroy: () => Promise<void>;
	pid: number;
};

// Per-file isolation, so concurrent files never share a global config dir.
// HOME is deliberately left alone: git still needs the real ~/.gitconfig.
const isolatedGlobalDir = fs.mkdtempSync(
	path.join(os.tmpdir(), 'epiq-e2e-global-'),
);

// On the worker's own env too, so in-process API calls see the same dir.
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

// Text inside the bottom box: the rows under the last full-width top border,
// joined, since a long input wraps onto a second row. The bottom border can
// sit below the last screen row, so the box ends at it or at the frame's end.
// Null while the box is not there, as when an external editor has the
// terminal or a frame is only half drawn and still ends in swimlane columns,
// whose top borders are several boxes wide rather than one.
const commandLineContent = (frame: string): string | null => {
	const lines = frame.split('\n').map(line => line.trim());
	const top = lines.findLastIndex(line => /^╭─+╮$/.test(line));
	if (top === -1) return null;

	const rows: string[] = [];

	for (const line of lines.slice(top + 1)) {
		if (line.startsWith('╰') || line === '') break;

		const match = /^│([^│]*)│$/.exec(line);
		if (!match) return null;

		rows.push((match[1] ?? '').trim());
	}

	return rows.length ? rows.join(' ').trim() : null;
};

/**
 * True when the command line holds no typed command: the bottom row is then
 * the shortcut bar rather than an input.
 */
// `destroy()` waits for the TUI and kills its process group first, so by now
// nothing should be writing here; the retries cover a git that escaped anyway.
export const removeTempRepo = (dir: string): void => {
	fs.rmSync(dir, {
		recursive: true,
		force: true,
		maxRetries: 20,
		retryDelay: 100,
	});
};

// An input opens with `:` or `?` and runs straight into the text or the
// cursor; the shortcut bar's leading `?` shortcut is followed by a space.
const isCommandInput = (content: string): boolean =>
	/^[:?](\S|$)/.test(content);

// The typed command as echoed in the command line, and only there: the
// shortcut bar repeats command names (`e edit description`), so a match
// anywhere on screen can fire before a keystroke has landed.
export const commandLineShows =
	(text: string) =>
	(frame: string): boolean => {
		const content = commandLineContent(frame);
		return (
			content !== null && isCommandInput(content) && content.includes(text)
		);
	};

export const commandLineIsIdle = (frame: string): boolean => {
	const content = commandLineContent(frame);
	return content !== null && !isCommandInput(content);
};

const describeWaitTarget = (
	text: string | RegExp | ((output: string) => boolean),
): string => {
	if (typeof text === 'string') return JSON.stringify(text);
	if (text instanceof RegExp) return String(text);
	return 'a predicate';
};

type SetupTuiOptions = {
	/** Left in place on `destroy()` so a later session can replay the log. */
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
	let lastDataAt = Date.now();

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

	const exited = new Promise<void>(resolve => {
		child.onExit(() => resolve());
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
		lastDataAt = Date.now();
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

	// One frame arrives as several PTY chunks, so a predicate can match a
	// half-drawn screen. Waiting for the stream to fall quiet returns only
	// complete frames; bounded because the animated sync indicator never stops.
	const SETTLE_QUIET_MS = 30;
	const MAX_SETTLE_WAIT_MS = 300;

	const settle = async () => {
		const settleDeadline = Date.now() + MAX_SETTLE_WAIT_MS;

		while (
			Date.now() - lastDataAt < SETTLE_QUIET_MS &&
			Date.now() < settleDeadline
		) {
			await sleep(5);
		}

		await flushOutput();
	};

	const getOutput = () => renderedOutput;

	const clearOutput = () => {
		terminal.reset();
		renderOutput();
	};

	// Removing the repo while the TUI or a git it spawned is still writing to
	// it fails with ENOTEMPTY, so the process goes first: wait for it to exit,
	// then kill its whole group — the pty made it a session leader, so the
	// group is exactly the children it left behind.
	const EXIT_WAIT_MS = 5_000;

	const destroy = async () => {
		if (destroyed) return;
		destroyed = true;

		try {
			child.write('\x03');
			child.kill();
		} catch {
			// noop
		}

		await Promise.race([exited, sleep(EXIT_WAIT_MS)]);

		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			// Nothing left in the group.
		}

		if (ownsCwd) {
			removeTempRepo(cwd);
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
			const matches = (output: string) =>
				typeof text === 'string'
					? output.includes(text)
					: text instanceof RegExp
					? text.test(output)
					: text(output);

			while (Date.now() - startedAt < timeoutMs) {
				await flushOutput();

				if (matches(getOutput())) {
					await settle();

					// Re-checked after settling: the frame that matched may have been
					// a partial one, and the completed frame is the truthful answer
					// either way.
					if (matches(getOutput())) return getOutput();
				}

				await sleep(1);
			}

			await flushOutput();

			// Throws rather than returning the last frame. Returning it made every
			// timeout surface as whatever assertion the caller ran next — "expected
			// '   …' to contain 'This folder is not…'" — which reads like a content
			// bug in the app instead of a wait that never came true.
			throw new Error(
				`Timed out after ${timeoutMs}ms waiting for ${describeWaitTarget(
					text,
				)}.\nLast rendered frame:\n${getOutput()}`,
			);
		},

		destroy,
		pid: child.pid,
	};
};
