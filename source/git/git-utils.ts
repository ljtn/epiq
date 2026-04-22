import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';

export type GitExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export const execGit = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<Result<GitExecResult>> =>
	new Promise(resolve => {
		if (!fs.existsSync(cwd)) {
			return resolve(failed(`Git cwd does not exist: ${cwd}`));
		}

		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;
		});

		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		child.on('error', err => {
			resolve(
				failed([`git ${args.join(' ')}`, `cwd=${cwd}`, err.message].join('\n')),
			);
		});

		child.on('close', code => {
			const exitCode = code ?? 1;

			if (exitCode !== 0) {
				resolve(
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

			resolve(
				succeeded('Git command succeeded', {
					stdout,
					stderr,
					exitCode,
				}),
			);
		});
	});

export const execGitAllowFail = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<GitExecResult> =>
	new Promise(resolve => {
		if (!fs.existsSync(cwd)) {
			return resolve({
				stdout: '',
				stderr: `Git cwd does not exist: ${cwd}`,
				exitCode: 1,
			});
		}

		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;
		});

		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		child.on('error', err => {
			resolve({
				stdout,
				stderr: err.message,
				exitCode: 1,
			});
		});

		child.on('close', code => {
			resolve({
				stdout,
				stderr,
				exitCode: code ?? 1,
			});
		});
	});

export const getRepoRoot = async (
	cwd = process.cwd(),
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--show-toplevel'],
		cwd,
	});

	if (isFail(result)) {
		return failed('Not inside a Git repository');
	}
	if (!result.data) {
		return failed('Git command returned no repo root');
	}

	return succeeded('Resolved repo root', result.data.stdout.trim());
};

export const getGitDir = async (repoRoot: string): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--git-dir'],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(result.message);
	}
	if (!result.data) {
		return failed('Git command returned no git dir');
	}

	const gitDir = result.data.stdout.trim();
	const resolved = path.isAbsolute(gitDir)
		? gitDir
		: path.join(repoRoot, gitDir);

	return succeeded('Resolved git dir', resolved);
};

export const hasInProgressGitOperation = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const gitDirResult = await getGitDir(repoRoot);
	if (isFail(gitDirResult)) {
		return failed(gitDirResult.message);
	}
	if (!gitDirResult.data) {
		return failed('Git dir result missing data');
	}

	const gitDir = gitDirResult.data;
	const markers = [
		'MERGE_HEAD',
		'CHERRY_PICK_HEAD',
		'REVERT_HEAD',
		'REBASE_HEAD',
		path.join('rebase-merge'),
		path.join('rebase-apply'),
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
	remote,
}: {
	repoRoot: string;
	remote: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['remote', 'get-url', remote],
		cwd: repoRoot,
	});

	return succeeded('Checked remote', result.exitCode === 0);
};

export const hasRemoteBranch = async ({
	repoRoot,
	remote,
	branch,
}: {
	repoRoot: string;
	remote: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['ls-remote', '--heads', remote, branch],
		cwd: repoRoot,
	});

	if (result.exitCode !== 0) {
		return failed(
			result.stderr.trim() ||
				`Unable to inspect remote branch ${remote}/${branch}`,
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

	if (isFail(result)) {
		return failed(result.message);
	}
	if (!result.data) {
		return failed('Git command returned no worktree data');
	}

	const normalized = path.resolve(worktreeRoot);
	const exists = result.data.stdout
		.split('\n')
		.filter(line => line.startsWith('worktree '))
		.map(line => line.slice('worktree '.length))
		.map(p => path.resolve(p))
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

	if (isFail(result)) {
		return failed(result.message);
	}
	if (!result.data) {
		return failed('Git command returned no branch name');
	}

	return succeeded('Resolved current branch', result.data.stdout.trim());
};

export const getShortHeadSha = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--short', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(result.message);
	}
	if (!result.data) {
		return failed('Git command returned no short sha');
	}

	return succeeded('Resolved short HEAD sha', result.data.stdout.trim());
};

export const pullBranchRebaseIfPresent = async ({
	cwd,
	remote,
	branch,
}: {
	cwd: string;
	remote: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(cwd);
	if (isFail(upstreamResult)) {
		return failed(upstreamResult.message);
	}
	if (!upstreamResult.data) {
		return succeeded('No upstream configured, skipped pull', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: cwd,
		remote,
		branch,
	});
	if (isFail(remoteBranchResult)) {
		return failed(remoteBranchResult.message);
	}
	if (!remoteBranchResult.data) {
		return succeeded('Remote branch missing, skipped pull', false);
	}

	const fetchResult = await execGit({
		args: ['fetch', remote, branch],
		cwd,
	});
	if (isFail(fetchResult)) {
		return failed(`Failed to fetch ${branch}\n${fetchResult.message}`);
	}
	if (!fetchResult.data) {
		return failed('Git command returned no fetch result data');
	}

	const pullResult = await execGit({
		args: ['pull', '--rebase'],
		cwd,
	});
	if (isFail(pullResult)) {
		return failed(`Failed during pull --rebase\n${pullResult.message}`);
	}
	if (!pullResult.data) {
		return failed('Git command returned no pull result data');
	}

	return succeeded('Pulled with rebase', true);
};
