import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getGitDir} from './git-storage.js';
import {ORIGIN} from './git-constants.js';

export type GitExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const GIT_TIMEOUT_MS = 15_000;

const gitEnv = {
	...process.env,
	GIT_TERMINAL_PROMPT: '0',
	GIT_ASKPASS: 'echo',
};

const runGit = ({
	args,
	cwd,
	allowFail,
}: {
	args: string[];
	cwd: string;
	allowFail: boolean;
}): Promise<Result<GitExecResult> | GitExecResult> =>
	new Promise(resolve => {
		if (!fs.existsSync(cwd)) {
			const message = `Git cwd does not exist: ${cwd}`;

			if (allowFail) {
				resolve({stdout: '', stderr: message, exitCode: 1});
				return;
			}

			resolve(failed(message));
			return;
		}

		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: gitEnv,
		});

		let settled = false;
		let stdout = '';
		let stderr = '';

		const finish = (value: Result<GitExecResult> | GitExecResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(value);
		};

		const timeout = setTimeout(() => {
			child.kill('SIGTERM');

			const message = [
				`git ${args.join(' ')}`,
				`cwd=${cwd}`,
				`Git command timed out after ${GIT_TIMEOUT_MS}ms`,
			].join('\n');

			if (allowFail) {
				finish({stdout, stderr: message, exitCode: 124});
			} else {
				finish(failed(message));
			}
		}, GIT_TIMEOUT_MS);

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;
		});

		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		child.on('error', error => {
			if (allowFail) {
				finish({stdout, stderr: error.message, exitCode: 1});
				return;
			}

			finish(
				failed(
					[`git ${args.join(' ')}`, `cwd=${cwd}`, error.message].join('\n'),
				),
			);
		});

		child.on('close', code => {
			const exitCode = code ?? 1;

			if (allowFail) {
				finish({stdout, stderr, exitCode});
				return;
			}

			if (exitCode !== 0) {
				finish(
					failed(
						[
							`git ${args.join(' ')}`,
							stderr.trim() || stdout.trim() || 'Git command failed',
						]
							.filter(Boolean)
							.join('\n'),
					),
				);
				return;
			}

			finish(
				succeeded('Git command succeeded', {
					stdout,
					stderr,
					exitCode,
				}),
			);
		});
	});

export const execGit = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<Result<GitExecResult>> =>
	runGit({args, cwd, allowFail: false}) as Promise<Result<GitExecResult>>;

export const execGitAllowFail = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<GitExecResult> =>
	runGit({args, cwd, allowFail: true}) as Promise<GitExecResult>;

export const commitAndGetSha = async ({
	cwd,
	message,
}: {
	cwd: string;
	message: string;
}): Promise<Result<string>> => {
	const commitResult = await execGit({
		args: ['commit', '-m', message],
		cwd,
	});

	if (isFail(commitResult)) {
		return failed(`Failed to create commit\n${commitResult.message}`);
	}

	const shaResult = await execGit({
		args: ['rev-parse', 'HEAD'],
		cwd,
	});

	if (isFail(shaResult)) {
		return failed(
			`Commit created, but failed to read HEAD SHA\n${shaResult.message}`,
		);
	}

	return succeeded(
		'Created commit and resolved SHA',
		shaResult.value.stdout.trim(),
	);
};

export const hasInProgressGitOperation = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const gitDirResult = await getGitDir(repoRoot);
	if (isFail(gitDirResult)) return failed(gitDirResult.message);

	const gitDir = gitDirResult.value;
	const markers = [
		'MERGE_HEAD',
		'CHERRY_PICK_HEAD',
		'REVERT_HEAD',
		'REBASE_HEAD',
		'rebase-merge',
		'rebase-apply',
	];

	const activeMarkers = markers.filter(marker =>
		fs.existsSync(path.join(gitDir, marker)),
	);

	return succeeded(
		'Checked for in-progress Git operation',
		activeMarkers.length > 0,
	);
};

export const hasRemote = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['remote', 'get-url', ORIGIN],
		cwd: repoRoot,
	});

	const hasRemoteResult = result.exitCode === 0;
	return succeeded(`Checked remote ${hasRemoteResult}`, hasRemoteResult);
};

export const hasRemoteBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['ls-remote', '--heads', ORIGIN, branch],
		cwd: repoRoot,
	});

	if (result.exitCode !== 0) {
		return failed(
			result.stderr.trim() ||
				`Unable to inspect remote branch ${ORIGIN}/${branch}`,
		);
	}

	return succeeded('Checked remote branch', result.stdout.trim().length > 0);
};

export const hasLocalBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Local branch exists', true);
	if (result.exitCode === 1) return succeeded('Local branch missing', false);

	return failed(result.stderr.trim() || `Unable to inspect branch ${branch}`);
};

const normalizeExistingPath = (p: string): string => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return path.resolve(p);
	}
};

export const hasWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['worktree', 'list', '--porcelain'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	const normalized = normalizeExistingPath(worktreeRoot);
	const exists = result.value.stdout
		.split('\n')
		.filter(line => line.startsWith('worktree '))
		.map(line => line.slice('worktree '.length))
		.map(normalizeExistingPath)
		.includes(normalized);

	return succeeded('Checked worktree registration', exists);
};

export const hasUpstream = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
		cwd: repoRoot,
	});

	return succeeded(
		'Checked upstream',
		result.exitCode === 0 && result.stdout.trim().length > 0,
	);
};

export const getCurrentBranchName = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved current branch', result.value.stdout.trim());
};

export const getShortHeadSha = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--short', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved short HEAD sha', result.value.stdout.trim());
};

export const isNonFastForward = (message: string): boolean =>
	message.includes('fetch first') ||
	message.includes('non-fast-forward') ||
	message.includes('failed to push some refs');

export const pullBranchRebaseIfPresent = async ({
	cwd,
	branch,
}: {
	cwd: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: cwd,
		branch,
	});

	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);
	if (!remoteBranchResult.value) {
		return succeeded('Remote branch missing, skipped pull', false);
	}

	const fetchResult = await execGit({
		args: ['fetch', ORIGIN, branch],
		cwd,
	});

	if (isFail(fetchResult))
		return failed(`Failed to fetch ${branch}\n${fetchResult.message}`);

	const pullResult = await execGit({
		args: ['pull', '--rebase', ORIGIN, branch],
		cwd,
	});

	if (isFail(pullResult)) {
		return failed(`Failed during pull --rebase\n${pullResult.message}`);
	}

	return succeeded('Pulled with rebase', true);
};

export const hasStateBranchChanges = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['status', '--porcelain'],
		cwd: stateBranchRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded(
		'Checked state branch changes',
		result.value.stdout.trim().length > 0,
	);
};

export const isDetachedHead = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const branchResult = await getCurrentBranchName(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	return succeeded(
		'Checked detached HEAD state',
		branchResult.value === 'HEAD',
	);
};
