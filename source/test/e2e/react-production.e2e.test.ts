import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Preloaded into the bin: lists every React build file Node loads.
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

describe('the npm bin', () => {
	it('runs React and ink on their production builds', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-react-'));
		const probePath = path.join(dir, 'probe.cjs');
		const logPath = path.join(dir, 'loaded.txt');
		fs.writeFileSync(probePath, probe);

		// A shell that sets no NODE_ENV, as a user's does; vitest sets one.
		const env: NodeJS.ProcessEnv = {...process.env, REACT_BUILD_LOG: logPath};
		delete env['NODE_ENV'];

		execFileSync(
			process.execPath,
			['--require', probePath, path.resolve('dist/index.js'), '--version'],
			{env},
		);

		const loaded = fs.readFileSync(logPath, 'utf8').trim().split('\n');
		fs.rmSync(dir, {recursive: true, force: true});

		expect(loaded.some(file => file.includes('react-reconciler'))).toBe(true);
		expect(loaded.filter(file => file.includes('.development.'))).toEqual([]);
	});
});
