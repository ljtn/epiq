import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from 'node-pty';
import {Terminal} from '@xterm/headless';

const width = 120;
const height = 20;

export const ENTER = '\r';
export const ARROW_DOWN = '\x1B\x5B\x42';
export const ARROW_UP = '\x1B\x5B\x41';
export const ARROW_RIGHT = '\x1B\x5B\x43';
export const ARROW_LEFT = '\x1B\x5B\x44';

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

const createTuiEnv = () => {
	const env = {...process.env};

	delete env['CI'];
	delete env['GITHUB_ACTIONS'];

	return {
		...env,
		TERM: 'xterm-256color',
		FORCE_COLOR: '1',
	};
};

const sleep = async (ms: number) =>
	await new Promise(resolve => setTimeout(resolve, ms));

export const setupTui = (args: string[] = []): TuiSession => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-'));
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
		env: createTuiEnv(),
	});

	const renderOutput = () => {
		const lines: string[] = [];

		for (let i = 0; i < height; i++) {
			lines.push(
				terminal.buffer.active.getLine(i)?.translateToString(true) ?? '',
			);
		}

		renderedOutput = lines.join('\n');
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

		fs.rmSync(cwd, {recursive: true, force: true});
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
