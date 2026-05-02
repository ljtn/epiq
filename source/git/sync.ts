import fs from 'node:fs';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	ensureStateBranchLayout,
	getEventFilePath,
	getStateBranchRoot,
	getRepoRootDir,
} from './git-storage.js';
import {
	execGit,
	hasInProgressGitOperation,
	hasStateBranchChanges,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {
	bootstrapStateStorageBase,
	createStateBranchSyncCommit,
	ensureInitialCommit,
	hydrateEventsFromStateBranch,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from './git.js';
import {mergeEventFile} from './merge.js';
import {STATE_BRANCH} from './git-constants.js';

export const syncEpiqFromRemote = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; stateBranchRoot: string}>> => {
	const ready = await ensureSyncReady({
		cwd,
		ensureUpstream: false,
	});
	if (isFail(ready)) return ready;

	const {repoRoot, stateBranchRoot} = ready.value;

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: stateBranchRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	const hydrateResult = hydrateEventsFromStateBranch({
		repoRoot,
		stateBranchRoot: stateBranchRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	return succeeded('Synced state branch', {
		repoRoot,
		stateBranchRoot,
	});
};

type SyncSummary = {
	repoRoot: string;
	stateBranchRoot: string;
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

export const mergeOwnEventFileToStateBranch = ({
	repoRoot,
	stateBranchRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ownEventFileName: string;
}): Result<boolean> => {
	const localFile = getEventFilePath({
		root: repoRoot,
		fileName: ownEventFileName,
	});

	const stateBranchFile = getEventFilePath({
		root: stateBranchRoot,
		fileName: ownEventFileName,
	});

	if (!fs.existsSync(localFile)) {
		return succeeded('Local own event file missing, nothing to merge', false);
	}

	return mergeEventFile({
		sourceFile: localFile,
		targetFile: stateBranchFile,
	});
};

const ensureSyncReady = async ({
	cwd,
	ensureUpstream,
}: {
	cwd: string;
	ensureUpstream: boolean;
}): Promise<
	Result<{
		repoRoot: string;
		stateBranchRoot: string;
		bootstrapped: boolean;
	}>
> => {
	const repoRootResult = await getRepoRootDir(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);
	const repoRoot = repoRootResult.value;

	const stateBranchRoot = getStateBranchRoot(repoRoot);

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);
	if (repoOpResult.value) {
		return failed(
			'Cannot sync while a git operation is in progress in the current repo',
		);
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	const bootstrapResult = await bootstrapStateStorageBase({
		repoRoot,
		stateBranchRoot,
		ensureUpstream,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const stateOpResult = await hasInProgressGitOperation(stateBranchRoot);
	if (isFail(stateOpResult)) return failed(stateOpResult.message);
	if (stateOpResult.value) {
		return failed(
			'Cannot sync while a git operation is in progress in the state branch',
		);
	}

	const layoutResult = ensureStateBranchLayout(repoRoot, stateBranchRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	return succeeded('Sync preconditions satisfied', {
		repoRoot,
		stateBranchRoot,
		bootstrapped: bootstrapResult.value,
	});
};

const commitOwnEventFileToStateBranch = async ({
	repoRoot,
	stateBranchRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<SyncOwnFileCommitResult>> => {
	const mergeResult = mergeOwnEventFileToStateBranch({
		repoRoot,
		stateBranchRoot,
		ownEventFileName,
	});
	if (isFail(mergeResult)) return failed(mergeResult.message);

	const changedResult = await hasStateBranchChanges(stateBranchRoot);
	if (isFail(changedResult)) return failed(changedResult.message);

	if (!mergeResult.value && !changedResult.value) {
		return succeeded('Own event file already up to date in state branch', {
			createdCommit: false,
		});
	}

	const stageResult = await stageStateBranchOwnEventFile({
		stateBranchRoot,
		ownEventFileName,
	});
	if (isFail(stageResult)) return failed(stageResult.message);

	const commitResult = await createStateBranchSyncCommit({
		repoRoot,
		stateBranchRoot,
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
	// Validate filename
	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		return failed('Own event file must be a file name, not a path');
	}
	if (!ownEventFileName.endsWith('.jsonl')) {
		return failed('Own event file must end with .jsonl');
	}

	const ready = await ensureSyncReady({
		cwd,
		ensureUpstream: true,
	});
	if (isFail(ready)) return ready;
	const {repoRoot, stateBranchRoot, bootstrapped} = ready.value;

	// Detached mode guard
	const detachedResult = await isDetachedHead(repoRoot);
	if (isFail(detachedResult)) return failed(detachedResult.message);
	if (detachedResult.value) {
		return failed(
			'Cannot run :sync while the repository is in detached HEAD state',
		);
	}

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: stateBranchRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	pulled = pullResult.value;

	const hydrateResult = hydrateEventsFromStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	hydrated = hydrateResult.value;

	const syncOwnResult = await commitOwnEventFileToStateBranch({
		repoRoot,
		stateBranchRoot,
		ownEventFileName,
	});
	if (isFail(syncOwnResult)) return failed(syncOwnResult.message);

	createdCommit = syncOwnResult.value.createdCommit;
	commitSha = syncOwnResult.value.commitSha;

	if (createdCommit || bootstrapped) {
		const pushResult = await pushStateBranch(stateBranchRoot);
		let finalPushResult = pushResult;

		if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
			const pullRetryResult = await pullBranchRebaseIfPresent({
				cwd: stateBranchRoot,
				branch: STATE_BRANCH,
			});
			if (isFail(pullRetryResult)) return failed(pullRetryResult.message);

			const retrySyncOwnResult = await commitOwnEventFileToStateBranch({
				repoRoot,
				stateBranchRoot: stateBranchRoot,
				ownEventFileName,
			});
			if (isFail(retrySyncOwnResult)) {
				return failed(retrySyncOwnResult.message);
			}

			if (retrySyncOwnResult.value.createdCommit) {
				createdCommit = true;
				commitSha = retrySyncOwnResult.value.commitSha;
			}

			finalPushResult = await pushStateBranch(stateBranchRoot);
		}

		if (isFail(finalPushResult)) return failed(finalPushResult.message);

		pushed = finalPushResult.value;
		logger.debug('[sync] pushed to state branch', pushed);
	} else {
		logger.debug('[sync] no commit created, skipped push');
	}

	if (createdCommit) {
		const finalShaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: stateBranchRoot,
		});
		if (isFail(finalShaResult)) return failed(finalShaResult.message);

		commitSha = finalShaResult.value.stdout.trim();
	}

	return succeeded('Synced event logs with state branch', {
		repoRoot,
		stateBranchRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped,
	});
};
