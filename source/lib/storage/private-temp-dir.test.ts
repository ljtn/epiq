import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {isFail, isSuccess, Result} from '../model/result-types.js';
import {privateTempDir} from './private-temp-dir.js';

// A temp root of this test's own, so the assertions are about directories this
// test created rather than whatever the developer's real one already holds.
let root: string;

// `isSuccess` is what narrows the value off null; `isFail` alone leaves it.
const unwrap = <T>(result: Result<T>): T => {
	if (!isSuccess(result)) throw new Error(result.message);
	return result.value;
};

const modeOf = (dir: string) => fs.statSync(dir).mode & 0o777;

describe('privateTempDir', () => {
	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-tmpdir-test-'));
		vi.spyOn(os, 'tmpdir').mockReturnValue(root);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(root, {recursive: true, force: true});
	});

	it('creates the directory it names', () => {
		const dir = unwrap(privateTempDir('commit-diffs'));

		expect(dir).toBe(path.join(root, 'epiq', 'commit-diffs'));
		expect(fs.existsSync(dir)).toBe(true);
	});

	// The whole point: on Linux `os.tmpdir()` is shared, and 0755 left a private
	// repository's diffs readable by every local account.
	it('is private, and so is every directory it created on the way', () => {
		const dir = unwrap(privateTempDir('commit-diffs', 'abc123'));

		expect(modeOf(dir)).toBe(0o700);
		expect(modeOf(path.join(root, 'epiq', 'commit-diffs'))).toBe(0o700);
		expect(modeOf(path.join(root, 'epiq'))).toBe(0o700);
	});

	// `mkdirSync` leaves an existing directory's permissions alone, so an older
	// build's 0755 would have survived every later run.
	it('tightens a directory that was already there and loose', () => {
		const existing = path.join(root, 'epiq', 'commit-diffs');
		fs.mkdirSync(existing, {recursive: true, mode: 0o755});
		fs.chmodSync(existing, 0o755);
		expect(modeOf(existing)).toBe(0o755);

		unwrap(privateTempDir('commit-diffs'));

		expect(modeOf(existing)).toBe(0o700);
	});

	// The attack this is for: a neighbour pre-creates the path as a symlink so
	// the diff is written through it, onto a file of their choosing.
	it('refuses to write through a symlink', () => {
		const elsewhere = path.join(root, 'elsewhere');
		fs.mkdirSync(elsewhere);
		fs.mkdirSync(path.join(root, 'epiq'), {recursive: true});
		fs.symlinkSync(elsewhere, path.join(root, 'epiq', 'commit-diffs'));

		const result = privateTempDir('commit-diffs');

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('symlink');
	});

	it('is safe to call again over a directory it already prepared', () => {
		const first = unwrap(privateTempDir('commit-diffs'));
		const second = unwrap(privateTempDir('commit-diffs'));

		expect(second).toBe(first);
		expect(modeOf(second)).toBe(0o700);
	});
});
