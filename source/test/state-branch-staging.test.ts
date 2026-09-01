/**
 * What a sync is allowed to put in a commit.
 *
 * `assertLogOnlyGrew` guards the event log at this boundary. These cover the
 * two paths beside it that had no guard: the media directory, staged by glob
 * so a missing blob committed its own deletion, and the storage-only repair,
 * which committed with no pathspec and so took whatever was in the index.
 */
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {stageStateBranchMediaFiles} from '../git/git.js';
import {ensureStateBranchIsStorageOnly} from '../git/git-storage.js';
import {isFail} from '../lib/model/result-types.js';
import {makeTempDir, useTempHome, writeFile} from './helpers/git-repo.js';

useTempHome();

const BLOB = `${'a'.repeat(64)}.png`;
const EVENT_FILE = '.epiq/events/01ksayra4ghekjp888wfbwbrdd.jola.jsonl';

const git = async (cwd: string, args: string[]): Promise<string> => {
	const result = await execGit({args, cwd});
	if (isFail(result))
		throw new Error(`git ${args.join(' ')}\n${result.message}`);
	return result.value.stdout;
};

const makeStateWorktree = async (): Promise<string> => {
	const root = makeTempDir();

	await git(root, ['init', '-q', '-b', 'epiq/state', '.']);
	await git(root, ['config', 'user.name', 'Test User']);
	await git(root, ['config', 'user.email', 'test@example.com']);

	writeFile(path.join(root, '.epiq', 'media', BLOB), 'not really a png');
	writeFile(path.join(root, EVENT_FILE), '{"v":1,"id":["A",null]}\n');

	await git(root, ['add', '.epiq']);
	await git(root, ['commit', '-qm', 'seed']);

	return root;
};

/** Paths the index has staged relative to HEAD, with their status letters. */
const staged = async (root: string): Promise<string[]> =>
	(await git(root, ['diff', '--cached', '--name-status']))
		.split('\n')
		.map(entry => entry.trim())
		.filter(Boolean);

describe('stageStateBranchMediaFiles', () => {
	it('stages a new blob', async () => {
		const root = await makeStateWorktree();
		const second = `${'b'.repeat(64)}.png`;

		writeFile(path.join(root, '.epiq', 'media', second), 'another');

		const result = await stageStateBranchMediaFiles({stateBranchRoot: root});
		expect(isFail(result)).toBe(false);

		expect(await staged(root)).toEqual([`A\t.epiq/media/${second}`]);
	});

	/**
	 * Nothing removes a blob on purpose — `delete.issue.attachment` writes a
	 * tombstone and keeps the bytes so a historical checkout can still render
	 * them — so a gap here is damage. Committing it published that damage to
	 * every clone, and the bytes have no other copy.
	 */
	it('does not commit a blob that has gone missing from the worktree', async () => {
		const root = await makeStateWorktree();

		fs.rmSync(path.join(root, '.epiq', 'media', BLOB));

		const result = await stageStateBranchMediaFiles({stateBranchRoot: root});
		expect(isFail(result)).toBe(false);

		expect(await staged(root)).toEqual([]);
	});
});

describe('ensureStateBranchIsStorageOnly', () => {
	it('leaves a branch that already holds only .epiq alone', async () => {
		const root = await makeStateWorktree();

		const result = await ensureStateBranchIsStorageOnly(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe(false);
	});

	/**
	 * This runs during bootstrap — before the pull, and before
	 * `stageStateBranchOwnEventFile` gets anywhere near it — so anything it
	 * sweeps up is published with no integrity check at all. A sync that died
	 * between `git add` and `git commit` leaves exactly that in the index.
	 */
	it('commits only what it removed, not whatever else is staged', async () => {
		const root = await makeStateWorktree();

		await git(root, ['config', 'user.name', 'Test User']);
		writeFile(path.join(root, 'README.md'), 'does not belong here\n');
		await git(root, ['add', 'README.md']);
		await git(root, ['commit', '-qm', 'stray file']);

		// What a crashed sync leaves behind: staged, uncommitted log content.
		writeFile(
			path.join(root, EVENT_FILE),
			'{"v":1,"id":["A",null]}\n{"x":1}\n',
		);
		await git(root, ['add', EVENT_FILE]);

		const result = await ensureStateBranchIsStorageOnly(root);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe(true);

		// The stray file is gone from HEAD...
		const tracked = await git(root, ['ls-tree', '--name-only', 'HEAD']);
		expect(tracked.split('\n').filter(Boolean)).toEqual(['.epiq']);

		// ...and the log content is still only staged, never published.
		expect(await staged(root)).toEqual([`M\t${EVENT_FILE}`]);
	});
});
