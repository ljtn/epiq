import fs from 'node:fs';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	execGit,
	hasInProgressGitOperation,
	hasRemoteWorktreeChanges,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {getRepoRootDir} from './git-file-system.js';
import {
	bootstrapRemoteStorageBase,
	createRemoteSyncCommit,
	DEFAULT_REMOTE,
	ensureInitialCommit,
	hydrateEventsFromRemote,
	pushRemote,
	REMOTE_BRANCH,
	stageRemoteOwnEventFile,
} from './git.js';
import {ensureRemoteLayout} from './git-file-system.js';
import {getEventFilePath} from './git-file-system.js';
import {getRemoteWorktreeRoot} from './git-file-system.js';
import {mergeEventFile} from './merge.js';

export const syncEpiqFromRemote = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; worktreeRoot: string}>> => {
	const repoRootResult = await getRepoRootDir(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.value;
	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);

	if (repoOpResult.value) {
		return failed(
			'Cannot sync while a git operation is in progress in the current repo',
		);
	}

	const ensureInitialCommitResult = await ensureInitialCommit(repoRoot);
	if (isFail(ensureInitialCommitResult)) {
		return failed(ensureInitialCommitResult.message);
	}

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: false,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);

	if (remoteOpResult.value) {
		return failed(
			'Cannot sync while a git operation is in progress in the remote worktree',
		);
	}

	const layoutResult = ensureRemoteLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	return succeeded('Synced from remote', {
		repoRoot,
		worktreeRoot,
	});
};

type SyncSummary = {
	repoRoot: string;
	worktreeRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	hydrated: boolean;
	bootstrapped: boolean;
};

type SyncArgs = {
	cwd?: string;
	ownEventFileName: string;
};

type SyncOwnFileCommitResult = {
	createdCommit: boolean;
	commitSha?: string;
};

export const mergeOwnEventFileToRemote = ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Result<boolean> => {
	const localFile = getEventFilePath({
		root: repoRoot,
		fileName: ownEventFileName,
	});

	const remoteFile = getEventFilePath({
		root: worktreeRoot,
		fileName: ownEventFileName,
	});

	if (!fs.existsSync(localFile)) {
		return succeeded('Local own event file missing, nothing to merge', false);
	}

	return mergeEventFile({
		sourceFile: localFile,
		targetFile: remoteFile,
	});
};

const syncOwnFileToRemoteCommit = async ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<SyncOwnFileCommitResult>> => {
	const mergeResult = mergeOwnEventFileToRemote({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(mergeResult)) return failed(mergeResult.message);

	const changedResult = await hasRemoteWorktreeChanges(worktreeRoot);
	if (isFail(changedResult)) return failed(changedResult.message);

	if (!mergeResult.value && !changedResult.value) {
		return succeeded('Own event file already up to date in remote worktree', {
			createdCommit: false,
		});
	}

	const stageResult = await stageRemoteOwnEventFile({
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(stageResult)) return failed(stageResult.message);

	const commitResult = await createRemoteSyncCommit({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Merged, staged, and committed own event file', {
		createdCommit: true,
		commitSha: commitResult.value,
	});
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	const repoRootDirResult = await getRepoRootDir(cwd);
	if (isFail(repoRootDirResult)) return failed(repoRootDirResult.message);
	const repoRoot = repoRootDirResult.value;

	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) {
		return failed(`Failed to ensure initial commit: ${initResult.message}`);
	}

	const isDetachedHeadResult = await isDetachedHead(repoRoot);
	if (isFail(isDetachedHeadResult)) return failed(isDetachedHeadResult.message);

	if (isDetachedHeadResult.value) {
		return failed(
			'Cannot run :sync while the repository is in detached HEAD state',
		);
	}

	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		return failed('Own event file must be a file name, not a path');
	}

	if (!ownEventFileName.endsWith('.jsonl')) {
		return failed('Own event file must end with .jsonl');
	}

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);

	if (repoOpResult.value) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the current repo',
		);
	}

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: true,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);

	if (remoteOpResult.value) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the remote worktree',
		);
	}

	const layoutResult = ensureRemoteLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	pulled = pullResult.value;

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	hydrated = hydrateResult.value;

	const syncOwnResult = await syncOwnFileToRemoteCommit({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(syncOwnResult)) return failed(syncOwnResult.message);

	createdCommit = syncOwnResult.value.createdCommit;
	commitSha = syncOwnResult.value.commitSha;

	if (createdCommit || bootstrapResult.value) {
		const pushResult = await pushRemote(worktreeRoot);
		let finalPushResult = pushResult;

		if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
			const pullRetryResult = await pullBranchRebaseIfPresent({
				cwd: worktreeRoot,
				remote: DEFAULT_REMOTE,
				branch: REMOTE_BRANCH,
			});
			if (isFail(pullRetryResult)) return failed(pullRetryResult.message);

			const retrySyncOwnResult = await syncOwnFileToRemoteCommit({
				repoRoot,
				worktreeRoot,
				ownEventFileName,
			});
			if (isFail(retrySyncOwnResult)) {
				return failed(retrySyncOwnResult.message);
			}

			if (retrySyncOwnResult.value.createdCommit) {
				createdCommit = true;
				commitSha = retrySyncOwnResult.value.commitSha;
			}

			finalPushResult = await pushRemote(worktreeRoot);
		}

		if (isFail(finalPushResult)) return failed(finalPushResult.message);

		pushed = finalPushResult.value;
		logger.debug('[sync] pushed remote', pushed);
	} else {
		logger.debug('[sync] no commit created, skipped push');
	}

	if (createdCommit) {
		const finalShaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: worktreeRoot,
		});
		if (isFail(finalShaResult)) return failed(finalShaResult.message);

		commitSha = finalShaResult.value.stdout.trim();
	}

	return succeeded('Synced event logs with remote', {
		repoRoot,
		worktreeRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped: bootstrapResult.value,
	});
};
