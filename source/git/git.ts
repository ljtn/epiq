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
	ensureWorktreesDir,
	ensureStateBranchIsStorageOnly,
	getEventsDir,
	getRelativeEventFilePath,
	listEventFiles,
	removePath,
} from './git-storage.js';
import {ORIGIN, STATE_BRANCH} from './git-constants.js';

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
		const remoteResult = await hasRemote({repoRoot});
		if (isFail(remoteResult)) return failed(remoteResult.message);
		if (!remoteResult.value) return succeeded('No remote configured', false);

		const result = await execGitAllowFail({
			args: ['ls-remote', '--heads', ORIGIN],
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

	const branch = result.value?.stdout.trim();
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

export const hydrateEventsFromStateBranch = ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Result<boolean> => {
	const remoteFilesResult = listEventFiles(stateBranchRoot);
	if (isFail(remoteFilesResult)) return failed(remoteFilesResult.message);

	const remoteEventsDir = getEventsDir(stateBranchRoot);
	const localEventsDir = getEventsDir(repoRoot);

	let changed = false;

	for (const fileName of remoteFilesResult.value) {
		const from = path.join(remoteEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

		const mergeResult = mergeEventFile({
			sourceFile: from,
			targetFile: to,
		});

		if (isFail(mergeResult)) return failed(mergeResult.message);

		changed = changed || mergeResult.value;
	}

	return succeeded('Hydrated event files from state branch', changed);
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
		branchResult.value,
	)}:${sanitizeRefSegment(shaResult.value)}]`;

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

	const commitSha = commitResult.value.stdout.trim();

	const updateRefResult = await execGit({
		args: ['update-ref', `refs/heads/${STATE_BRANCH}`, commitSha],
		cwd: repoRoot,
	});

	if (isFail(updateRefResult)) {
		return failed(
			`Failed to create ${STATE_BRANCH}\n${updateRefResult.message}`,
		);
	}

	return succeeded('Created empty storage branch', true);
};

const ensureLocalStateBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const localResult = await hasLocalBranch({
		repoRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(localResult))
		return failed('Ensure local state branch failed\n' + localResult.message);

	if (localResult.value) {
		return succeeded('Local state branch already exists', false);
	}

	const hasRemoteResult = await hasRemote({
		repoRoot,
	});

	if (isFail(hasRemoteResult)) {
		return failed(
			'Ensure local state branch failed. ' + hasRemoteResult.message,
		);
	}

	if (!hasRemoteResult.value) {
		return createEmptyStorageBranch(repoRoot);
	}

	if (hasRemoteResult.value) {
		const remoteBranchResult = await hasRemoteBranch({
			repoRoot,
			branch: STATE_BRANCH,
		});
		if (isFail(remoteBranchResult)) {
			return failed(
				'Ensure local branch failed. ' + remoteBranchResult.message,
			);
		}

		if (remoteBranchResult.value) {
			// fetch remote branch before local track

			const fetchResult = await execGit({
				args: ['fetch', ORIGIN, STATE_BRANCH],
				cwd: repoRoot,
			});
			if (isFail(fetchResult)) {
				return failed(
					`Failed to fetch ${STATE_BRANCH} from remote\n${fetchResult.message}`,
				);
			}

			// create local tracking branch

			const createFromRemote = await execGit({
				args: ['branch', '--track', STATE_BRANCH, `${ORIGIN}/${STATE_BRANCH}`],
				cwd: repoRoot,
			});
			if (isFail(createFromRemote)) {
				return failed(
					`Failed to create local ${STATE_BRANCH} from remote\n${createFromRemote.message}`,
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

	const lines = result.value.stdout.split('\n');
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

const createStateWorktree = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<boolean>> => {
	const ensureRoot = ensureDir(path.dirname(stateBranchRoot));
	if (isFail(ensureRoot))
		return failed('Failed to create state worktree\n' + ensureRoot.message);

	if (
		fs.existsSync(stateBranchRoot) &&
		!fs.existsSync(path.join(stateBranchRoot, '.git'))
	) {
		logger.debug('remove broken state branch path', stateBranchRoot);
		removePath(stateBranchRoot);
	}

	const result = await execGit({
		args: ['worktree', 'add', stateBranchRoot, STATE_BRANCH],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to create state branch\n${result.message}`);
	}

	return succeeded('Created state worktree', true);
};

const ensureStateBranchRoot = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<boolean>> => {
	const existingBranchWorktreeResult = await getWorktreeRootForBranch({
		repoRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(existingBranchWorktreeResult)) {
		return failed(existingBranchWorktreeResult.message);
	}

	const existingBranchWorktree = existingBranchWorktreeResult.value;
	const expected = path.resolve(stateBranchRoot);
	const existing = existingBranchWorktree
		? path.resolve(existingBranchWorktree)
		: null;

	if (existing && existing === expected && fs.existsSync(existing)) {
		return succeeded(
			'State branch already checked out in expected worktree',
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
				`Failed to remove existing state branch\n${removeResult.message}`,
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

	const registeredResult = await hasWorktree({
		repoRoot,
		worktreeRoot: stateBranchRoot,
	});
	if (isFail(registeredResult)) return failed(registeredResult.message);

	const existsOnDisk = fs.existsSync(stateBranchRoot);

	if (registeredResult.value && existsOnDisk) {
		return succeeded('Remote state branch already exists', false);
	}

	if (registeredResult.value && !existsOnDisk) {
		const pruneResult = await execGit({
			args: ['worktree', 'prune'],
			cwd: repoRoot,
		});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	return createStateWorktree({repoRoot, stateBranchRoot});
};

const ensureStateBranchCheckedOut = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const currentBranchResult = await getCurrentBranchName(stateBranchRoot);
	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	if (currentBranchResult.value === STATE_BRANCH) {
		return succeeded('State branch already checked out', false);
	}

	const checkoutResult = await execGit({
		args: ['checkout', STATE_BRANCH],
		cwd: stateBranchRoot,
	});

	if (isFail(checkoutResult)) {
		return failed(
			`Failed to checkout ${STATE_BRANCH}\n${checkoutResult.message}`,
		);
	}

	return succeeded('Checked out state branch', true);
};

const ensureStateBranchTracksRemote = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(stateBranchRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	if (upstreamResult.value) {
		return succeeded('Remote upstream already configured', false);
	}

	const remoteResult = await hasRemote({
		repoRoot: stateBranchRoot,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (!remoteResult.value) {
		return succeeded('No remote available for upstream', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: stateBranchRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

	if (!remoteBranchResult.value) {
		return succeeded(
			'Remote branch missing; upstream will be configured on first push',
			false,
		);
	}

	const fetchResult = await execGit({
		args: ['fetch', ORIGIN, STATE_BRANCH],
		cwd: stateBranchRoot,
	});
	if (isFail(fetchResult)) {
		return failed(`Failed to fetch ${STATE_BRANCH}\n${fetchResult.message}`);
	}

	const setUpstreamResult = await execGit({
		args: [
			'branch',
			'--set-upstream-to',
			`${ORIGIN}/${STATE_BRANCH}`,
			STATE_BRANCH,
		],
		cwd: stateBranchRoot,
	});

	if (isFail(setUpstreamResult)) {
		return failed(
			`Failed to set remote upstream\n${setUpstreamResult.message}`,
		);
	}

	return succeeded('Configured remote upstream', true);
};

export const stageStateBranchOwnEventFile = async ({
	stateBranchRoot,
	ownEventFileName,
}: {
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<void>> => {
	const result = await execGit({
		args: ['add', getRelativeEventFilePath(ownEventFileName)],
		cwd: stateBranchRoot,
	});

	if (isFail(result)) {
		return failed(
			`Failed to stage state branch own event file\n${result.message}`,
		);
	}

	return succeeded('Staged state branch own event file', undefined);
};

export const createStateBranchSyncCommit = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<string>> => {
	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult))
		return failed(
			'Create state branch sync commit failed \n' + messageResult.message,
		);

	return commitAndGetSha({
		cwd: stateBranchRoot,
		message: messageResult.value,
	});
};

export const pushStateBranch = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(stateBranchRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	const result = await execGit({
		args: upstreamResult.value
			? ['push']
			: ['push', '-u', ORIGIN, STATE_BRANCH],
		cwd: stateBranchRoot,
	});

	if (isFail(result)) {
		return failed(`Failed during state branch push\n${result.message}`);
	}

	return succeeded('Pushed state branch', true);
};

export const bootstrapStateStorageBase = async ({
	repoRoot,
	stateBranchRoot,
	ensureUpstream,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ensureUpstream: boolean;
}): Promise<Result<boolean>> => {
	let changed = false;

	const steps: Result[] = [
		ensureWorktreesDir(),
		await ensureLocalStateBranch({repoRoot}),
		await ensureStateBranchRoot({
			repoRoot,
			stateBranchRoot,
		}),
		await ensureStateBranchCheckedOut(stateBranchRoot),
		await ensureStateBranchIsStorageOnly(stateBranchRoot),
		ensureUpstream
			? await ensureStateBranchTracksRemote(stateBranchRoot)
			: succeeded('Skipped remote upstream bootstrap', false),
	];

	for (const step of steps) {
		if (isFail(step)) return failed(step.message);
		changed = changed || Boolean(step.value);
	}

	return succeeded(
		ensureUpstream
			? 'Bootstrapped remote storage'
			: 'Bootstrapped remote storage (readonly)',
		changed,
	);
};
