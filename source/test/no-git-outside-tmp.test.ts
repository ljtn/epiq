import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';

// The guard in `setup/no-git-outside-tmp.ts` is the only thing standing between
// a stray cwd and the developer's branches, so it needs a test of its own —
// otherwise it can rot into decoration that never fires.

const created: string[] = [];

afterEach(() => {
	for (const dir of created.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-guard-'));
	created.push(dir);
	return dir;
};

describe('git is confined to throwaway directories in tests', () => {
	it('refuses git aimed at the checkout', () => {
		expect(() =>
			childProcess.execFileSync('git', ['status'], {cwd: process.cwd()}),
		).toThrow(/Refusing to run git outside a throwaway directory/);
	});

	// Absent cwd means `process.cwd()`, which under vitest is the checkout.
	it('refuses git with no cwd at all', () => {
		expect(() => childProcess.execFileSync('git', ['status'])).toThrow(
			/Refusing to run git outside a throwaway directory/,
		);
	});

	it('allows git in a temp directory', () => {
		const dir = tempDir();

		expect(() =>
			childProcess.execFileSync('git', ['init', '-q', '.'], {cwd: dir}),
		).not.toThrow();
	});

	// The variable that actually caused the damage: it overrides discovery, so
	// the cwd looks innocent while git acts on someone else's repository.
	it('clears the hook variables git exports', () => {
		for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
			expect(process.env[name], name).toBeUndefined();
		}
	});

	it('refuses to hand a child a git repository override', () => {
		const dir = tempDir();

		expect(() =>
			childProcess.execFileSync('git', ['status'], {
				cwd: dir,
				env: {...process.env, GIT_DIR: '/somewhere/else/.git'},
			}),
		).toThrow(/Refusing to run git with GIT_DIR set/);
	});

	// Only git is confined; everything else a test spawns is its own business.
	it('leaves other commands alone', () => {
		expect(() =>
			childProcess.execFileSync('node', ['-e', '0'], {cwd: process.cwd()}),
		).not.toThrow();
	});
});
