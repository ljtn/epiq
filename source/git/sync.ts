import fs from 'node:fs';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';
import {
	execGit,
	getRepoRoot,
	hasInProgressGitOperation,
	hasRemoteWorktreeChanges,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {
	bootstrapRemoteStorageBase,
	createRemoteSyncCommit,
	DEFAULT_REMOTE,
	ensureInitialCommit,
	ensureRemoteLayout,
	getEventFilePath,
	getRemoteWorktreeRoot,
	hydrateEventsFromRemote,
	pushRemote,
	REMOTE_BRANCH,
	stageRemoteOwnEventFile,
} from './git.js';
import {mergeEventFile} from './merge.js';

export const syncEpiqFromRemote = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; worktreeRoot: string}>> => {
	logger.debug('[sync] start readonly sync', {cwd});

	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);

	logger.debug('[sync] resolved readonly roots', {
		repoRoot,
		worktreeRoot,
	});

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);

	if (repoOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the current repo',
		);
	}

	const ensureInitialCommitResult = await ensureInitialCommit(repoRoot);
	if (isFail(ensureInitialCommitResult)) {
		return failed(ensureInitialCommitResult.message);
	}

	logger.debug(
		'[sync] readonly ensure initial commit changed',
		ensureInitialCommitResult.data,
	);

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: false,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);

	if (remoteOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the remote worktree',
		);
	}

	const layoutResult = ensureRemoteLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	logger.debug('[sync] readonly pull remote branch');

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	logger.debug('[sync] readonly pulled remote', pullResult.data);

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	logger.debug('[sync] readonly hydrated from remote', hydrateResult.data);

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
		logger.debug('[sync] local own event file missing', localFile);
		return succeeded('Local own event file missing, nothing to merge', false);
	}

	logger.debug('[sync] merge own event file to remote', {
		ownEventFileName,
		localFile,
		remoteFile,
	});

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

	if (!mergeResult.data && !changedResult.data) {
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
		commitSha: commitResult.data,
	});
};

const logOwnEventFileSizes = ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): void => {
	const localFile = getEventFilePath({
		root: repoRoot,
		fileName: ownEventFileName,
	});

	const remoteFile = getEventFilePath({
		root: worktreeRoot,
		fileName: ownEventFileName,
	});

	logger.debug('[sync] own event file sizes', {
		local: fs.existsSync(localFile) ? fs.statSync(localFile).size : 0,
		remote: fs.existsSync(remoteFile) ? fs.statSync(remoteFile).size : 0,
	});
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	logger.debug('[sync] start write sync', {
		cwd,
		ownEventFileName,
	});

	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);

	logger.debug('[sync] resolved roots', {
		repoRoot,
		worktreeRoot,
	});

	const detachedResult = await isDetachedHead(repoRoot);
	if (isFail(detachedResult)) return failed(detachedResult.message);

	if (detachedResult.data) {
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

	if (repoOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the current repo',
		);
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	logger.debug('[sync] ensure initial commit changed', initResult.data);

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: true,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);

	if (remoteOpResult.data) {
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

	logger.debug('[sync] pull remote branch before local copy');

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	pulled = pullResult.data;
	logger.debug('[sync] pulled remote', pulled);

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	hydrated = hydrateResult.data;
	logger.debug('[sync] hydrated from remote', hydrated);

	const syncOwnResult = await syncOwnFileToRemoteCommit({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(syncOwnResult)) return failed(syncOwnResult.message);

	createdCommit = syncOwnResult.data.createdCommit;
	commitSha = syncOwnResult.data.commitSha;

	logOwnEventFileSizes({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});

	logger.debug('[sync] sync own file result', syncOwnResult.data);

	if (createdCommit || bootstrapResult.data) {
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

			if (retrySyncOwnResult.data.createdCommit) {
				createdCommit = true;
				commitSha = retrySyncOwnResult.data.commitSha;
			}

			logOwnEventFileSizes({
				repoRoot,
				worktreeRoot,
				ownEventFileName,
			});

			logger.debug(
				'[sync] retry sync own file result',
				retrySyncOwnResult.data,
			);

			finalPushResult = await pushRemote(worktreeRoot);
		}

		if (isFail(finalPushResult)) return failed(finalPushResult.message);

		pushed = finalPushResult.data;
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

		commitSha = finalShaResult.data.stdout.trim();
	}

	return succeeded('Synced event logs with remote', {
		repoRoot,
		worktreeRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped: bootstrapResult.data,
	});
};
