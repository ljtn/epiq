import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';

// `epiq gui` opens the user's browser on startup. Shadowing the opener on PATH
// keeps a full test run from throwing windows at whoever is running it, and
// costs nothing on a machine that has no opener at all.
const browserShimDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-gui-no-open-'));

	for (const name of ['open', 'xdg-open']) {
		const shim = path.join(dir, name);
		fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n');
		fs.chmodSync(shim, 0o755);
	}

	return dir;
};

const URL_LINE = /http:\/\/\S*?:(\d+)/;

/**
 * A second GUI over the same repo, served by `dist/index.js` rather than by
 * this process.
 *
 * The rest of the suite runs the server from source under `IS_LOCAL`, which
 * resolves the client bundle from the working directory; the built CLI
 * resolves it beside its own module and, in a binary, out of the SEA assets.
 * Neither of those paths was ever opened in a browser, so a bundle that only
 * fails once packaged shipped green.
 */
export const serveDist = async (
	repoRoot: string,
	globalDir: string,
): Promise<{url: string; kill: () => void}> => {
	const cliPath = path.resolve(process.cwd(), 'dist/index.js');

	if (!fs.existsSync(cliPath)) {
		throw new Error(
			`${cliPath} is missing — run \`npm run build:npm\` before the GUI suite.`,
		);
	}

	const shimDir = browserShimDir();
	// Dropping IS_LOCAL is the point of this server: with it, the built CLI
	// would look for the client in the working directory, exactly as the source
	// path already does.
	const {IS_LOCAL: _fromSource, ...parentEnv} = process.env;

	const env = {
		...parentEnv,
		PATH: `${shimDir}${path.delimiter}${parentEnv['PATH'] ?? ''}`,
		// The seeded project's state lives here; the worker's own environment
		// still points at the real one.
		EPIQ_GLOBAL_DIR: globalDir,
	};

	const child: ChildProcess = spawn(process.execPath, [cliPath, 'gui'], {
		cwd: repoRoot,
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	const kill = () => {
		child.kill('SIGTERM');
		fs.rmSync(shimDir, {recursive: true, force: true});
	};

	let output = '';
	child.stdout?.on('data', chunk => (output += String(chunk)));
	child.stderr?.on('data', chunk => (output += String(chunk)));

	let exited = false;
	child.on('exit', () => (exited = true));

	const deadline = Date.now() + 60_000;

	// It reports itself as epiq.localhost; only the port is portable, since a
	// browser cannot be relied on to resolve that name.
	while (!URL_LINE.test(output)) {
		if (exited) {
			throw new Error(`Built GUI exited before it served:\n${output}`);
		}

		if (Date.now() > deadline) {
			kill();
			throw new Error(`Timed out starting the built GUI:\n${output}`);
		}

		await new Promise(resolve => setTimeout(resolve, 50));
	}

	const port = URL_LINE.exec(output)![1];

	return {url: `http://127.0.0.1:${port}`, kill};
};
