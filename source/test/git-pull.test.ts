import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {execGit, pullBranchRebaseIfPresent} from '../git/git-utils.js';
import {isFail} from '../lib/model/result-types.js';
import {makeTempDir, useTempHome, writeFile} from './helpers/git-repo.js';

useTempHome();

describe('pullBranchRebaseIfPresent', () => {
	const gitIn = async (cwd: string, args: string[]) => {
		const result = await execGit({args, cwd});
		if (isFail(result)) throw new Error(result.message);
		return result.value.stdout;
	};

	// Events land in the state worktree while a sync is running, so the pull has
	// to tolerate a dirty tree rather than aborting the rebase.
	it('pulls with an uncommitted change in the worktree', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');
		const other = path.join(root, 'other');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);

		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'events.jsonl'), 'one\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);
		await gitIn(local, ['push', '-q', 'origin', 'HEAD:main']);

		await gitIn(root, ['clone', '-q', remote, 'other']);
		await gitIn(other, ['config', 'user.email', 'b@b']);
		await gitIn(other, ['config', 'user.name', 'b']);
		writeFile(path.join(other, 'theirs.jsonl'), 'theirs\n');
		await gitIn(other, ['add', '-A']);
		await gitIn(other, ['commit', '-qm', 'remote side']);
		await gitIn(other, ['push', '-q', 'origin', 'main']);

		// The mid-sync append.
		writeFile(path.join(local, 'events.jsonl'), 'one\ntwo\n');

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'main',
		});

		expect(isFail(result)).toBe(false);
		expect(fs.readFileSync(path.join(local, 'events.jsonl'), 'utf8')).toBe(
			'one\ntwo\n',
		);
		expect(fs.existsSync(path.join(local, 'theirs.jsonl'))).toBe(true);
		if (!isFail(result)) expect(result.value).toBe(true);
	});

	it('reports no pull when the remote has nothing new', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);
		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'f.txt'), 'x\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);
		await gitIn(local, ['push', '-q', 'origin', 'HEAD:main']);

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'main',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) expect(result.value).toBe(false);
	});

	it('reports no pull when the branch is absent from the remote', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);
		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'f.txt'), 'x\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'nope',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) expect(result.value).toBe(false);
	});
});
