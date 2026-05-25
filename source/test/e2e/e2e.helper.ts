import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';

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
	waitFor: (text: string | RegExp, timeoutMs?: number) => Promise<string>;
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

	let output = '';
	let destroyed = false;

	const child = pty.spawn(process.execPath, [cliPath, ...args], {
		name: 'xterm-color',
		cols: width,
		rows: height,
		cwd,
		env: createTuiEnv(),
	});

	child.onData(data => {
		// Output full single frames with given dimensions only, otherwise the test output becomes unreliable
		data = stripAnsi(data).replace(/\r\n/g, '\n').replace(/\r/g, '');

		const prevRows = output.split('\n');
		const additionalRows = data.split('\n');

		const lastPrev = prevRows.at(-1) ?? '';
		const firstAdditional = additionalRows.at(0) ?? '';

		if (lastPrev.length < width && prevRows.length > 0) {
			prevRows[prevRows.length - 1] = lastPrev + firstAdditional;
			additionalRows.shift();
		}

		const allRows = [...prevRows, ...additionalRows];

		output = allRows.slice(-height).join('\n');
	});

	const getOutput = () => stripAnsi(output);

	const clearOutput = () => {
		output = '';
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
				clearOutput();
				child.write(item);
			}
		},

		output: getOutput,
		clear: clearOutput,

		waitFor: async (text, timeoutMs = 2_000) => {
			const startedAt = Date.now();

			while (Date.now() - startedAt < timeoutMs) {
				const currentOutput = getOutput();

				if (typeof text === 'string') {
					if (currentOutput.includes(text)) {
						return currentOutput;
					}
				} else {
					if (text.test(currentOutput)) {
						return currentOutput;
					}
				}

				await sleep(5);
			}

			return getOutput();
		},

		destroy,
	};
};
