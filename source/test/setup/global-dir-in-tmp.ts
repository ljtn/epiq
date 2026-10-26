/**
 * Keeps tests off the real `~/.epiq-global`, which holds live event logs:
 * defaulted to tmp up front, asserted per test.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeEach} from 'vitest';
import {getGlobalConfigDir} from '../../lib/storage/global-config-dir.js';

const tempRoot = fs.realpathSync(os.tmpdir());

// Realpath through the nearest existing ancestor, so a not-yet-created dir
// under the symlinked macOS tmpdir still canonicalizes to the same root.
const canonicalize = (target: string): string => {
	let current = path.resolve(target);
	let suffix = '';

	for (;;) {
		try {
			return path.join(fs.realpathSync(current), suffix);
		} catch {
			suffix = path.join(path.basename(current), suffix);
			const parent = path.dirname(current);
			if (parent === current) return path.join(current, suffix);
			current = parent;
		}
	}
};

export const assertGlobalDirThrowaway = (dir: string): void => {
	// Unlike the git guard, a missing dir is NOT safe here — the first write
	// mkdirs it for real — so canonicalize rather than allow.
	const resolved = canonicalize(dir);

	if (resolved === tempRoot || resolved.startsWith(tempRoot + path.sep)) {
		return;
	}

	throw new Error(
		`Refusing to run tests with the Epiq global dir outside a throwaway directory.\n` +
			`  resolved: ${resolved}\n` +
			`It holds the real state-branch worktree, so tests writing there ` +
			`publish events into production boards. Point EPIQ_GLOBAL_DIR under ` +
			`${tempRoot}.`,
	);
};

// Made here, so removed here once the file's tests are done: clones and locks
// would otherwise pile up under the OS tmpdir run after run.
const made = process.env['EPIQ_GLOBAL_DIR']
	? null
	: fs.mkdtempSync(path.join(tempRoot, 'epiq-global-'));
if (made) {
	process.env['EPIQ_GLOBAL_DIR'] = made;
	afterAll(() => {
		fs.rmSync(made, {recursive: true, force: true});
		delete process.env['EPIQ_GLOBAL_DIR'];
	});
}

assertGlobalDirThrowaway(getGlobalConfigDir());

beforeEach(() => {
	assertGlobalDirThrowaway(getGlobalConfigDir());
});
