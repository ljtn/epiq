import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {git} from '../git/git-commands.js';
import {isFail} from '../lib/model/result-types.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-git-commands-'));
	tempDirs.push(dir);
	return dir;
};

const configureIdentity = async (repoRoot: string): Promise<void> => {
	for (const [key, value] of [
		['user.name', 'Test User'],
		['user.email', 'test@example.com'],
	] as const) {
		const result = await execGit({args: ['config', key, value], cwd: repoRoot});
		if (isFail(result)) throw new Error(result.message);
	}
};

const initRepo = async (repoRoot: string): Promise<void> => {
	const initResult = await execGit({
		args: ['init', '-b', 'main'],
		cwd: repoRoot,
	});
	if (isFail(initResult)) throw new Error(initResult.message);
	await configureIdentity(repoRoot);
};

// Stands in for a host repo's own hook (lint, tests, whatever) — epiq's
// bookkeeping commits and pushes are not the user's changes and must not be
// subject to it. Always rejects, so a passing test proves it never ran.
const writeRejectingHook = (
	repoRoot: string,
	name: 'pre-commit' | 'pre-push',
): void => {
	fs.writeFileSync(
		path.join(repoRoot, '.git', 'hooks', name),
		'#!/bin/sh\nexit 1\n',
		{mode: 0o755},
	);
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('git.commit', () => {
	it('bypasses a repo pre-commit hook', async () => {
		const repoRoot = makeTempDir();
		await initRepo(repoRoot);
		writeRejectingHook(repoRoot, 'pre-commit');

		fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'hello\n', 'utf8');
		const stageResult = await git.stage({cwd: repoRoot, pathspec: ['a.txt']});
		if (isFail(stageResult)) throw new Error(stageResult.message);

		const commitResult = await git.commit({
			cwd: repoRoot,
			message: '[epiq:test]',
			pathspec: ['a.txt'],
		});

		expect(isFail(commitResult)).toBe(false);
	});
});

describe('git.push', () => {
	it('bypasses a repo pre-push hook', async () => {
		const remoteRoot = makeTempDir();
		const initBareResult = await execGit({
			args: ['init', '--bare', '-b', 'main'],
			cwd: remoteRoot,
		});
		if (isFail(initBareResult)) throw new Error(initBareResult.message);

		const repoRoot = makeTempDir();
		const cloneResult = await execGit({
			args: ['clone', remoteRoot, repoRoot],
			cwd: remoteRoot,
		});
		if (isFail(cloneResult)) throw new Error(cloneResult.message);
		await configureIdentity(repoRoot);

		fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'hello\n', 'utf8');
		const addResult = await execGit({args: ['add', 'a.txt'], cwd: repoRoot});
		if (isFail(addResult)) throw new Error(addResult.message);
		const commitResult = await execGit({
			args: ['commit', '-m', 'initial'],
			cwd: repoRoot,
		});
		if (isFail(commitResult)) throw new Error(commitResult.message);

		writeRejectingHook(repoRoot, 'pre-push');

		const pushResult = await git.push({
			cwd: repoRoot,
			remote: 'origin',
			branch: 'main',
			setUpstream: true,
		});

		expect(isFail(pushResult)).toBe(false);
	});
});
