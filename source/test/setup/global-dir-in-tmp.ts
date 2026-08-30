/**
 * The real `~/.epiq-global` holds the state-branch worktree — the live event
 * logs of every project on this machine. A test that resolves it writes real
 * events without ever running git outside tmp, so `no-git-outside-tmp` never
 * fires; a 529-line `*.test.jsonl` log ended up committed to this repo's own
 * state branch that way.
 *
 * Defaulted first, so a suite that forgets `EPIQ_GLOBAL_DIR` is isolated
 * rather than failed; asserted per test, so one that points it somewhere real
 * fails on the spot.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach} from 'vitest';
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

if (!process.env['EPIQ_GLOBAL_DIR']) {
	process.env['EPIQ_GLOBAL_DIR'] = fs.mkdtempSync(
		path.join(tempRoot, 'epiq-global-'),
	);
}

assertGlobalDirThrowaway(getGlobalConfigDir());

beforeEach(() => {
	assertGlobalDirThrowaway(getGlobalConfigDir());
});
