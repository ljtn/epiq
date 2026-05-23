import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';

type TuiSession = {
	cwd: string;
	input: (value: string | string[]) => void;
	output: () => string;
	waitFor: (text: string, timeoutMs?: number) => Promise<string>;
	clear: () => void;
	destroy: () => void;
};
const createTuiEnv = () => {
	const env = {...process.env};

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
		cols: 120,
		rows: 20,
		cwd,
		env: createTuiEnv(),
	});

	child.onData(data => {
		output += data;
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

		input: value => {
			clearOutput();
			const values = Array.isArray(value) ? value : [value];

			for (const item of values) {
				child.write(item);
			}
		},

		output: getOutput,
		clear: clearOutput,

		waitFor: async (text, timeoutMs = 2000) => {
			const startedAt = Date.now();

			while (Date.now() - startedAt < timeoutMs) {
				const currentOutput = getOutput();

				if (currentOutput.includes(text)) {
					return currentOutput;
				}

				await sleep(25);
			}

			return getOutput();
		},

		destroy,
	};
};
