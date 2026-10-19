import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Preloaded into a bin: lists every React build file Node loads.
const probe = `
const Module = require('node:module');
const fs = require('node:fs');
const load = Module._load;
Module._load = function (request, parent, isMain) {
	const loaded = load.apply(this, arguments);
	try {
		const file = Module._resolveFilename(request, parent, isMain);
		if (/react[^/]*[/\\\\]cjs[/\\\\]/.test(file)) {
			fs.appendFileSync(process.env.REACT_BUILD_LOG, file + '\\n');
		}
	} catch {}
	return loaded;
};
`;

const readLines = (file: string): string[] =>
	fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];

// Runs a bin until it has loaded the reconciler, or for ten seconds.
const reactBuildsLoadedBy = async (
	bin: string,
	args: string[],
): Promise<string[]> => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-react-'));
	const probePath = path.join(dir, 'probe.cjs');
	const logPath = path.join(dir, 'loaded.txt');
	fs.writeFileSync(probePath, probe);

	// A shell that sets no NODE_ENV, as a user's does; vitest sets one.
	const env: NodeJS.ProcessEnv = {
		...process.env,
		REACT_BUILD_LOG: logPath,
		EPIQ_GLOBAL_DIR: path.join(dir, 'global'),
	};
	delete env['NODE_ENV'];

	const child = spawn(
		process.execPath,
		['--require', probePath, path.resolve(bin), ...args],
		{cwd: dir, env, stdio: ['pipe', 'ignore', 'ignore']},
	);
	const exited = new Promise(resolve => child.once('exit', resolve));

	const deadline = Date.now() + 10_000;
	while (
		Date.now() < deadline &&
		!readLines(logPath).some(file => file.includes('react-reconciler.'))
	) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	child.kill();
	await exited;

	const loaded = readLines(logPath);
	fs.rmSync(dir, {recursive: true, force: true});

	return loaded;
};

describe('the npm bins run React on its production build', () => {
	it.each([
		['epiq', 'dist/index.js', ['--version']],
		['epiq-mcp', 'dist/mcp.js', []],
	])('%s', async (_name, bin, args) => {
		const loaded = await reactBuildsLoadedBy(bin, args);

		expect(loaded.some(file => file.includes('react-reconciler.'))).toBe(true);
		expect(loaded.filter(file => file.includes('.development.'))).toEqual([]);
	});
});
