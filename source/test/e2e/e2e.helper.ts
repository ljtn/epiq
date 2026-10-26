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
// `1;2` is the shift modifier of the CSI sequence the plain arrows send.
export const SHIFT_ARROW_DOWN = '\x1B\x5B\x31\x3B\x32\x42';
export const SHIFT_ARROW_UP = '\x1B\x5B\x31\x3B\x32\x41';

const MOVE_CURSOR_HOME = '\x1B[H';
const CLEAR_SCREEN = '\x1B[2J';
const HIDE_CURSOR = '\x1B[?25l';
const SHOW_CURSOR = '\x1B[?25h';

// Stretches every wait on a loaded machine (the container stage) without
// slowing failures on a quiet one.
const TIMEOUT_SCALE = Number(process.env['EPIQ_E2E_TIMEOUT_SCALE'] ?? 1);

let lastLoggedOutput = '';

const logFrame = (output: string) => {
	if (output === lastLoggedOutput) return;

	lastLoggedOutput = output;

	process.stdout.write(
		HIDE_CURSOR + MOVE_CURSOR_HOME + CLEAR_SCREEN + output + SHOW_CURSOR,
	);
};

export type TuiSession = {
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

// Text inside the bottom box, its rows joined since long input wraps. Null
// while the box isn't drawn, e.g. an external editor has the terminal.
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

// An input opens with `:` or `?` and no space (the shortcut bar has one), or
// with an ellipsis once a long command scrolls its `:` off the left.
const isCommandInput = (content: string): boolean =>
	/^[:?](\S|$)/.test(content) || content.startsWith('…');

// The typed command as echoed in the command line only: the shortcut bar
// repeats command names.
export const commandLineShows =
	(text: string) =>
	(frame: string): boolean => {
		const content = commandLineContent(frame);
		return (
			content !== null && isCommandInput(content) && content.includes(text)
		);
	};

// No typed command: the bottom row is the shortcut bar.
export const commandLineIsIdle = (frame: string): boolean => {
	const content = commandLineContent(frame);
	return content !== null && !isCommandInput(content);
};

const ESCAPE = '\x1B';

// How long the keypress listener holds a lone `ESC` before reading it as
// Escape (`getDataListener`); input inside that window races it.
const ESCAPE_SETTLE_MS = 60;

/**
 * Steps back through command history, one expectation per press, restarting the
 * walk when a pty splits `ESC [ A` and the lone `ESC` closes the line.
 */
export const recallFromHistory = async (
	tui: TuiSession,
	shows: readonly string[],
	attempts = 3,
): Promise<string[]> => {
	const failures: string[] = [];

	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			tui.input(':');
			await tui.waitFor(output => output.includes('Mode: cmd-line'));

			const frames: string[] = [];
			for (const text of shows) {
				tui.input(ARROW_UP);
				frames.push(await tui.waitFor(commandLineShows(text)));
			}

			return frames;
		} catch (error) {
			failures.push(`attempt ${attempt}: ${String(error)}`);

			// Back to the board before retrying, but only if something is open:
			// an Escape on an idle board would close the line being reopened.
			if (!commandLineIsIdle(tui.output())) {
				tui.input(ESCAPE);
				await tui.waitFor(commandLineIsIdle);
			}

			// Whatever put the line in the state above may itself have been a
			// lone `ESC` that has not resolved yet.
			await sleep(ESCAPE_SETTLE_MS);
		}
	}

	throw new Error(
		`Command history recall failed ${attempts} times.\n${failures.join(
			'\n',
		)}\nLast rendered frame:\n${tui.output()}`,
	);
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

	// The process goes first, or removing the repo hits ENOTEMPTY: wait, then
	// kill its group (the pty made it a session leader).
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
			const deadline = timeoutMs * TIMEOUT_SCALE;
			const startedAt = Date.now();
			const matches = (output: string) =>
				typeof text === 'string'
					? output.includes(text)
					: text instanceof RegExp
					? text.test(output)
					: text(output);

			while (Date.now() - startedAt < deadline) {
				await flushOutput();

				if (matches(getOutput())) {
					await settle();

					// Re-checked after settling: the match may have been a partial frame.
					if (matches(getOutput())) return getOutput();
				}

				await sleep(1);
			}

			await flushOutput();

			// Throws on timeout, so it isn't misread as a content assertion failing.
			throw new Error(
				`Timed out after ${deadline}ms waiting for ${describeWaitTarget(
					text,
				)}.\nLast rendered frame:\n${getOutput()}`,
			);
		},

		destroy,
		pid: child.pid,
	};
};
