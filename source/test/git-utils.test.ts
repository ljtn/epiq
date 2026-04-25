import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	getCurrentBranchName,
	getGitDir,
	hasInProgressGitOperation,
	hasUpstream,
	isDetachedHead,
	pullBranchRebaseIfPresent,
} from '../git/git-utils.js';
import {isFail} from '../lib/command-line/command-types.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-git-utils-'));
	tempDirs.push(dir);
	return dir;
};

const initRepo = async (repoRoot: string): Promise<void> => {
	const initResult = await execGit({
		args: ['init', '-b', 'main'],
		cwd: repoRoot,
	});
	if (isFail(initResult)) throw new Error(initResult.message);

	const nameResult = await execGit({
		args: ['config', 'user.name', 'Test User'],
		cwd: repoRoot,
	});
	if (isFail(nameResult)) throw new Error(nameResult.message);

	const emailResult = await execGit({
		args: ['config', 'user.email', 'test@example.com'],
		cwd: repoRoot,
	});
	if (isFail(emailResult)) throw new Error(emailResult.message);
};

const writeFile = (
	repoRoot: string,
	fileName: string,
	content: string,
): void => {
	fs.writeFileSync(path.join(repoRoot, fileName), content, 'utf8');
};

const commitFile = async ({
	repoRoot,
	fileName,
	content,
	message,
}: {
	repoRoot: string;
	fileName: string;
	content: string;
	message: string;
}): Promise<void> => {
	writeFile(repoRoot, fileName, content);

	const addResult = await execGit({
		args: ['add', fileName],
		cwd: repoRoot,
	});
	if (isFail(addResult)) throw new Error(addResult.message);

	const commitResult = await execGit({
		args: ['commit', '-m', message],
		cwd: repoRoot,
	});
	if (isFail(commitResult)) throw new Error(commitResult.message);
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('git-utils', () => {
	it('execGit fails when cwd does not exist', async () => {
		const result = await execGit({
			args: ['status'],
			cwd: '/definitely/does/not/exist',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('Git cwd does not exist');
		}
	});

	it('execGitAllowFail returns exitCode 1 when cwd does not exist', async () => {
		const result = await execGitAllowFail({
			args: ['status'],
			cwd: '/definitely/does/not/exist',
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Git cwd does not exist');
	});

	it('commitAndGetSha creates a commit and returns HEAD sha', async () => {
		const repoRoot = makeTempDir();
		await initRepo(repoRoot);

		writeFile(repoRoot, 'a.txt', 'hello');

		const addResult = await execGit({
			args: ['add', 'a.txt'],
			cwd: repoRoot,
		});
		if (isFail(addResult)) throw new Error(addResult.message);

		const commitResult = await commitAndGetSha({
			cwd: repoRoot,
			message: 'test commit',
		});

		expect(isFail(commitResult)).toBe(false);
		if (!isFail(commitResult)) {
			expect(commitResult.data).toMatch(/^[0-9a-f]{40}$/);
		}
	});

	it('isDetachedHead is false on a normal branch and true after checking out HEAD directly', async () => {
		const repoRoot = makeTempDir();
		await initRepo(repoRoot);
		await commitFile({
			repoRoot,
			fileName: 'a.txt',
			content: 'hello',
			message: 'initial',
		});

		const beforeResult = await isDetachedHead(repoRoot);
		expect(isFail(beforeResult)).toBe(false);
		if (!isFail(beforeResult)) {
			expect(beforeResult.data).toBe(false);
		}

		const shaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: repoRoot,
		});
		if (isFail(shaResult)) throw new Error(shaResult.message);

		const checkoutResult = await execGit({
			args: ['checkout', shaResult.data.stdout.trim()],
			cwd: repoRoot,
		});
		if (isFail(checkoutResult)) throw new Error(checkoutResult.message);

		const afterResult = await isDetachedHead(repoRoot);
		expect(isFail(afterResult)).toBe(false);
		if (!isFail(afterResult)) {
			expect(afterResult.data).toBe(true);
		}

		const branchNameResult = await getCurrentBranchName(repoRoot);
		expect(isFail(branchNameResult)).toBe(false);
		if (!isFail(branchNameResult)) {
			expect(branchNameResult.data).toBe('HEAD');
		}
	});

	it('hasInProgressGitOperation detects a merge marker in .git', async () => {
		const repoRoot = makeTempDir();
		await initRepo(repoRoot);
		await commitFile({
			repoRoot,
			fileName: 'a.txt',
			content: 'hello',
			message: 'initial',
		});

		const gitDirResult = await getGitDir(repoRoot);
		if (isFail(gitDirResult)) throw new Error(gitDirResult.message);

		fs.writeFileSync(
			path.join(gitDirResult.data, 'MERGE_HEAD'),
			'dummy',
			'utf8',
		);

		const result = await hasInProgressGitOperation(repoRoot);
		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.data).toBe(true);
		}
	});

	it('pullBranchRebaseIfPresent fails when remote is missing', async () => {
		const repoRoot = makeTempDir();
		await initRepo(repoRoot);
		await commitFile({
			repoRoot,
			fileName: 'a.txt',
			content: 'hello',
			message: 'initial',
		});

		const pullResult = await pullBranchRebaseIfPresent({
			cwd: repoRoot,
			remote: 'origin',
			branch: 'main',
		});

		expect(isFail(pullResult)).toBe(true);
		if (isFail(pullResult)) {
			expect(pullResult.message).toContain('origin');
		}
	});

	it('pullBranchRebaseIfPresent pulls when upstream exists', async () => {
		const remoteRoot = makeTempDir();
		const repoA = makeTempDir();
		const repoB = makeTempDir();

		const remoteInit = await execGit({
			args: ['init', '--bare'],
			cwd: remoteRoot,
		});
		if (isFail(remoteInit)) throw new Error(remoteInit.message);

		const cloneA = await execGit({
			args: ['clone', remoteRoot, repoA],
			cwd: path.dirname(repoA),
		});
		if (isFail(cloneA)) throw new Error(cloneA.message);

		const cloneB = await execGit({
			args: ['clone', remoteRoot, repoB],
			cwd: path.dirname(repoB),
		});
		if (isFail(cloneB)) throw new Error(cloneB.message);

		for (const repoRoot of [repoA, repoB]) {
			const nameResult = await execGit({
				args: ['config', 'user.name', 'Test User'],
				cwd: repoRoot,
			});
			if (isFail(nameResult)) throw new Error(nameResult.message);

			const emailResult = await execGit({
				args: ['config', 'user.email', 'test@example.com'],
				cwd: repoRoot,
			});
			if (isFail(emailResult)) throw new Error(emailResult.message);
		}

		await commitFile({
			repoRoot: repoA,
			fileName: 'a.txt',
			content: 'one',
			message: 'initial',
		});

		const pushInitial = await execGit({
			args: ['push', '-u', 'origin', 'master'],
			cwd: repoA,
		});
		const pushInitialMain = await execGitAllowFail({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoA,
		});
		if (isFail(pushInitial) && pushInitialMain.exitCode !== 0) {
			throw new Error('Unable to push initial branch');
		}

		const branchResult = await getCurrentBranchName(repoA);
		if (isFail(branchResult)) throw new Error(branchResult.message);
		const branch = branchResult.data;

		const pullB = await execGit({
			args: ['pull', '--rebase'],
			cwd: repoB,
		});
		if (isFail(pullB)) throw new Error(pullB.message);

		await commitFile({
			repoRoot: repoA,
			fileName: 'a.txt',
			content: 'two',
			message: 'update from A',
		});

		const pushA = await execGit({
			args: ['push'],
			cwd: repoA,
		});
		if (isFail(pushA)) throw new Error(pushA.message);

		const pullResult = await pullBranchRebaseIfPresent({
			cwd: repoB,
			remote: 'origin',
			branch,
		});

		expect(isFail(pullResult)).toBe(false);
		if (!isFail(pullResult)) {
			expect(pullResult.data).toBe(true);
		}

		const content = fs.readFileSync(path.join(repoB, 'a.txt'), 'utf8');
		expect(content).toBe('two');
	});
});
