import fs from 'node:fs';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {memoizeResult} from '../lib/utils/memoize.js';
import {logger} from '../logger.js';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	getCurrentBranchName,
	getShortHeadSha,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
	hasUpstream,
	hasWorktree,
} from './git-utils.js';
import {mergeEventFile} from './merge.js';
import {
	EMPTY_TREE_SHA,
	ensureDir,
	ensureEpiqStorage,
	ensureRemoteBranchIsStorageOnly,
	getEventsDir,
	getRelativeEventFilePath,
	listEventFiles,
	removePath,
} from './git-file-system.js';

export const REMOTE_BRANCH = 'epiq/events';
export const DEFAULT_REMOTE = 'origin';

const hasHeadCommit = async (repoRoot: string): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Repo has HEAD', true);
	if (result.exitCode === 1) return succeeded('Repo has no HEAD', false);

	return failed(result.stderr.trim() || 'Unable to inspect HEAD');
};

const remoteHasAnyHistory = memoizeResult(
	async (repoRoot: string): Promise<Result<boolean>> => {
		const remoteResult = await hasRemote({
			repoRoot,
			remote: DEFAULT_REMOTE,
		});
		if (isFail(remoteResult)) return failed(remoteResult.message);
		if (!remoteResult.data) return succeeded('No remote configured', false);

		const result = await execGitAllowFail({
			args: ['ls-remote', '--heads', DEFAULT_REMOTE],
			cwd: repoRoot,
		});

		if (result.exitCode !== 0) {
			return failed(result.stderr.trim() || 'Unable to inspect remote heads');
		}

		const hasHistory = result.stdout.trim().length > 0;

		return succeeded('Checked remote history', hasHistory);
	},
	(repoRoot: string) => path.resolve(repoRoot),
);

export const hasAnyCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Repository has commits', true);

	return succeeded('Repository has no commits', false);
};

export const isHeadAttached = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['symbolic-ref', '--short', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(
			'Cannot sync from detached HEAD. Checkout a branch before syncing.',
		);
	}

	const branch = result.data?.stdout.trim();
	if (!branch) {
		return failed('Cannot resolve current branch');
	}

	return succeeded('Resolved current branch', branch);
};

export const ensureInitialCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const headResult = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (headResult.exitCode === 0) {
		return succeeded('Initial commit already exists', false);
	}

	const commitResult = await execGit({
		args: ['commit', '--allow-empty', '-m', 'Initial commit'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Created initial commit', true);
};

export const hydrateEventsFromRemote = ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Result<boolean> => {
	const remoteFilesResult = listEventFiles(worktreeRoot);
	if (isFail(remoteFilesResult)) return failed(remoteFilesResult.message);

	const remoteEventsDir = getEventsDir(worktreeRoot);
	const localEventsDir = getEventsDir(repoRoot);

	let changed = false;

	for (const fileName of remoteFilesResult.data) {
		const from = path.join(remoteEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

		const mergeResult = mergeEventFile({
			sourceFile: from,
			targetFile: to,
		});

		if (isFail(mergeResult)) return failed(mergeResult.message);

		changed = changed || mergeResult.data;
	}

	return succeeded('Hydrated event files from remote worktree', changed);
};

const sanitizeRefSegment = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._/-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-/.]+|[-/.]+$/g, '') || 'unknown';

const buildSyncCommitMessage = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const branchResult = await getCurrentBranchName(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	const shaResult = await getShortHeadSha(repoRoot);
	if (isFail(shaResult)) return failed(shaResult.message);

	const message = `[epiq:sync:${sanitizeRefSegment(
		branchResult.data,
	)}:${sanitizeRefSegment(shaResult.data)}]`;

	return succeeded('Built sync commit message', message);
};

const createEmptyStorageBranch = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const commitResult = await execGit({
		args: ['commit-tree', EMPTY_TREE_SHA, '-m', '[epiq:init-storage-branch]'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(
			`Failed to create storage branch commit\n${commitResult.message}`,
		);
	}

	const commitSha = commitResult.data.stdout.trim();

	const updateRefResult = await execGit({
		args: ['update-ref', `refs/heads/${REMOTE_BRANCH}`, commitSha],
		cwd: repoRoot,
	});

	if (isFail(updateRefResult)) {
		return failed(
			`Failed to create ${REMOTE_BRANCH}\n${updateRefResult.message}`,
		);
	}

	return succeeded('Created empty storage branch', true);
};

const ensureRemoteStateBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const localResult = await hasLocalBranch({
		repoRoot,
		branch: REMOTE_BRANCH,
	});
	if (isFail(localResult))
		return failed('Ensure local branch failed. ' + localResult.message);

	if (localResult.data) {
		return succeeded('Local remote branch already exists', false);
	}

	const hasRemoteResult = await hasRemote({
		repoRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(hasRemoteResult) || !hasRemoteResult.data) {
		return failed('Ensure local branch failed. ' + hasRemoteResult.message);
	}

	if (hasRemoteResult.data) {
		const remoteBranchResult = await hasRemoteBranch({
			repoRoot,
			remote: DEFAULT_REMOTE,
			branch: REMOTE_BRANCH,
		});
		if (isFail(remoteBranchResult)) {
			return failed(
				'Ensure local branch failed. ' + remoteBranchResult.message,
			);
		}

		if (remoteBranchResult.data) {
			// fetch remote branch before local track

			const fetchResult = await execGit({
				args: ['fetch', DEFAULT_REMOTE, REMOTE_BRANCH],
				cwd: repoRoot,
			});
			if (isFail(fetchResult)) {
				return failed(
					`Failed to fetch ${REMOTE_BRANCH} from remote\n${fetchResult.message}`,
				);
			}

			// create local tracking branch

			const createFromRemote = await execGit({
				args: [
					'branch',
					'--track',
					REMOTE_BRANCH,
					`${DEFAULT_REMOTE}/${REMOTE_BRANCH}`,
				],
				cwd: repoRoot,
			});
			if (isFail(createFromRemote)) {
				return failed(
					`Failed to create local ${REMOTE_BRANCH} from remote\n${createFromRemote.message}`,
				);
			}

			return succeeded('Created local remote branch from remote', true);
		}
	}

	return createEmptyStorageBranch(repoRoot);
};

const getWorktreeRootForBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<string | null>> => {
	const result = await execGit({
		args: ['worktree', 'list', '--porcelain'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	const lines = result.data.stdout.split('\n');
	let currentWorktree: string | null = null;

	for (const line of lines) {
		if (line.startsWith('worktree ')) {
			currentWorktree = line.slice('worktree '.length);
			continue;
		}

		if (line === `branch refs/heads/${branch}` && currentWorktree) {
			return succeeded('Found worktree for branch', currentWorktree);
		}
	}

	return succeeded('No worktree found for branch', null);
};

const createRemoteWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const ensureRoot = ensureDir(path.dirname(worktreeRoot));
	if (isFail(ensureRoot))
		return failed('Failed to create remote worktree\n' + ensureRoot.message);

	if (
		fs.existsSync(worktreeRoot) &&
		!fs.existsSync(path.join(worktreeRoot, '.git'))
	) {
		logger.debug('remove broken remote worktree path', worktreeRoot);
		removePath(worktreeRoot);
	}

	const result = await execGit({
		args: ['worktree', 'add', worktreeRoot, REMOTE_BRANCH],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to create remote worktree\n${result.message}`);
	}

	return succeeded('Created remote worktree', true);
};

const ensureRemoteWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const existingBranchWorktreeResult = await getWorktreeRootForBranch({
		repoRoot,
		branch: REMOTE_BRANCH,
	});
	if (isFail(existingBranchWorktreeResult)) {
		return failed(existingBranchWorktreeResult.message);
	}

	const existingBranchWorktree = existingBranchWorktreeResult.data;
	const expected = path.resolve(worktreeRoot);
	const existing = existingBranchWorktree
		? path.resolve(existingBranchWorktree)
		: null;

	if (existing && existing === expected && fs.existsSync(existing)) {
		return succeeded(
			'Remote branch already checked out in expected worktree',
			false,
		);
	}

	if (existing && existing !== expected) {
		const removeResult = await execGit({
			args: ['worktree', 'remove', '--force', existing],
			cwd: repoRoot,
		});

		if (isFail(removeResult)) {
			return failed(
				`Failed to remove existing remote worktree\n${removeResult.message}`,
			);
		}
	}

	if (existing && !fs.existsSync(existing)) {
		const pruneResult = await execGit({
			args: ['worktree', 'prune'],
			cwd: repoRoot,
		});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	const registeredResult = await hasWorktree({repoRoot, worktreeRoot});
	if (isFail(registeredResult)) return failed(registeredResult.message);

	const existsOnDisk = fs.existsSync(worktreeRoot);

	if (registeredResult.data && existsOnDisk) {
		return succeeded('Remote worktree already exists', false);
	}

	if (registeredResult.data && !existsOnDisk) {
		const pruneResult = await execGit({
			args: ['worktree', 'prune'],
			cwd: repoRoot,
		});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	return createRemoteWorktree({repoRoot, worktreeRoot});
};

const ensureRemoteBranchCheckedOut = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const currentBranchResult = await getCurrentBranchName(worktreeRoot);
	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	if (currentBranchResult.data === REMOTE_BRANCH) {
		return succeeded('Remote branch already checked out', false);
	}

	const checkoutResult = await execGit({
		args: ['checkout', REMOTE_BRANCH],
		cwd: worktreeRoot,
	});

	if (isFail(checkoutResult)) {
		return failed(
			`Failed to checkout ${REMOTE_BRANCH}\n${checkoutResult.message}`,
		);
	}

	return succeeded('Checked out remote branch', true);
};

const ensureLocalTracksRemote = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	if (upstreamResult.data) {
		return succeeded('Remote upstream already configured', false);
	}

	const remoteResult = await hasRemote({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (!remoteResult.data) {
		return succeeded('No remote available for upstream', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

	if (!remoteBranchResult.data) {
		return succeeded(
			'Remote branch missing; upstream will be configured on first push',
			false,
		);
	}

	const fetchResult = await execGit({
		args: ['fetch', DEFAULT_REMOTE, REMOTE_BRANCH],
		cwd: worktreeRoot,
	});
	if (isFail(fetchResult)) {
		return failed(`Failed to fetch ${REMOTE_BRANCH}\n${fetchResult.message}`);
	}

	const setUpstreamResult = await execGit({
		args: [
			'branch',
			'--set-upstream-to',
			`${DEFAULT_REMOTE}/${REMOTE_BRANCH}`,
			REMOTE_BRANCH,
		],
		cwd: worktreeRoot,
	});

	if (isFail(setUpstreamResult)) {
		return failed(
			`Failed to set remote upstream\n${setUpstreamResult.message}`,
		);
	}

	return succeeded('Configured remote upstream', true);
};

export const stageRemoteOwnEventFile = async ({
	worktreeRoot,
	ownEventFileName,
}: {
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<void>> => {
	const result = await execGit({
		args: ['add', getRelativeEventFilePath(ownEventFileName)],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to stage remote own event file\n${result.message}`);
	}

	return succeeded('Staged remote own event file', undefined);
};

export const createRemoteSyncCommit = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<string>> => {
	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult))
		return failed(
			'Create remote sync commit failed \n' + messageResult.message,
		);

	return commitAndGetSha({
		cwd: worktreeRoot,
		message: messageResult.data,
	});
};

export const pushRemote = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	const result = await execGit({
		args: upstreamResult.data
			? ['push']
			: ['push', '-u', DEFAULT_REMOTE, REMOTE_BRANCH],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed during remote push\n${result.message}`);
	}

	return succeeded('Pushed remote', true);
};

export const bootstrapRemoteStorageBase = async ({
	repoRoot,
	worktreeRoot,
	ensureUpstream,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ensureUpstream: boolean;
}): Promise<Result<boolean>> => {
	let changed = false;

	const steps: Result[] = [
		ensureEpiqStorage(),
		await ensureRemoteStateBranch({repoRoot}),
		await ensureRemoteWorktree({repoRoot, worktreeRoot}),
		await ensureRemoteBranchCheckedOut(worktreeRoot),
		await ensureRemoteBranchIsStorageOnly(worktreeRoot),
		ensureUpstream
			? await ensureLocalTracksRemote(worktreeRoot)
			: succeeded('Skipped remote upstream bootstrap', false),
	];

	for (const step of steps) {
		if (isFail(step)) return failed(step.message);
		changed = changed || Boolean(step.data);
	}

	return succeeded(
		ensureUpstream
			? 'Bootstrapped remote storage'
			: 'Bootstrapped remote storage (readonly)',
		changed,
	);
};
