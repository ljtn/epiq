import fs from 'node:fs';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	failSync,
	setSynced,
	setSyncing,
	setSyncOffline,
} from '../lib/state/sync-state.js';
import {trace} from '../lib/utils/logger.utils.js';
import {getStateBranch} from './git-constants.js';
import {
	ensureStateBranchLayout,
	getRepoRootDir,
	getStateBranchRoot,
} from './git-storage.js';
import {
	execGit,
	hasInProgressGitOperation,
	hasStagedChanges,
	isAheadOfUpstream,
	isDetachedHead,
	isNonFastForward,
	isRemoteUnreachable,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {
	bootstrapStateBranchStorage,
	createStateBranchSyncCommit,
	pushStateBranch,
	stageStateBranchEventAttributes,
	stageStateBranchMediaFiles,
	stageStateBranchOwnEventFile,
} from './git.js';
import {restoreDroppedEventLines, snapshotEventLogs} from './log-integrity.js';
import {withSyncLock} from './sync-lock.js';

type SyncSummary = {
	repoRoot: string;
	stateBranchRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	bootstrapped: boolean;
	// Local work is committed; the remote could not be reached.
	offline: boolean;
	// Another process held the state worktree; nothing was attempted.
	skipped?: boolean;
};

type SyncArgs = {
	cwd?: string;
	ownEventFileName: string;
};

type SyncOwnFileCommitResult = {
	createdCommit: boolean;
	commitSha?: string;
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
	logger.debug('[sync] ensureSyncReady:start', {cwd, ensureUpstream});

	const repoRootResult = trace('getRepoRootDir', await getRepoRootDir(cwd));
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.value;

	logger.debug('[sync] repo root', repoRoot);

	const stateBranchRootResult = trace(
		'getStateBranchRoot',
		getStateBranchRoot({repoRoot}),
	);
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	logger.debug('[sync] state branch root', stateBranchRoot);

	logger.debug('[sync] bootstrapping state branch storage', {
		repoRoot,
		stateBranchRoot,
		ensureUpstream,
	});

	const bootstrapResult = trace(
		'bootstrapStateBranchStorage',
		await bootstrapStateBranchStorage({
			repoRoot,
			stateBranchRoot,
			ensureUpstream,
		}),
	);
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	logger.debug('[sync] bootstrap result', {
		bootstrapped: bootstrapResult.value,
		stateBranchRoot,
	});

	logger.debug('[sync] checking state branch git operation', {
		stateBranchRoot,
	});

	const stateOpResult = trace(
		'hasInProgressGitOperation(stateBranchRoot)',
		await hasInProgressGitOperation(stateBranchRoot),
	);
	if (isFail(stateOpResult)) return failed(stateOpResult.message);

	logger.debug('[sync] state branch git operation check result', {
		inProgress: stateOpResult.value,
	});

	if (stateOpResult.value) {
		logger.info('[sync] state branch git operation in progress');
		return failed(
			'Cannot sync while a git operation is in progress in the state branch',
		);
	}

	logger.debug('[sync] ensuring state branch layout', {
		repoRoot,
		stateBranchRoot,
	});

	const layoutResult = trace(
		'ensureStateBranchLayout',
		ensureStateBranchLayout(repoRoot, stateBranchRoot),
	);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	logger.debug('[sync] state branch layout ready');

	logger.debug('[sync] ensureSyncReady:done', {
		repoRoot,
		stateBranchRoot,
		bootstrapped: bootstrapResult.value,
	});

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
	logger.debug('[sync] committing own event file from state branch', {
		ownEventFileName,
		stateBranchRoot,
	});

	logger.debug('[sync] staging own event file', {
		stateBranchRoot,
		ownEventFileName,
	});

	const stageResult = trace(
		'stageStateBranchOwnEventFile',
		await stageStateBranchOwnEventFile({
			stateBranchRoot,
			eventFileName: ownEventFileName,
		}),
	);
	if (isFail(stageResult)) return failed(stageResult.message);

	const stageMediaResult = trace(
		'stageStateBranchMediaFiles',
		await stageStateBranchMediaFiles({stateBranchRoot}),
	);
	if (isFail(stageMediaResult)) return failed(stageMediaResult.message);

	const stageAttributesResult = trace(
		'stageStateBranchEventAttributes',
		await stageStateBranchEventAttributes({stateBranchRoot}),
	);
	if (isFail(stageAttributesResult)) {
		return failed(stageAttributesResult.message);
	}

	const pathspec = [
		stageResult.value,
		stageMediaResult.value,
		stageAttributesResult.value,
	].filter((entry): entry is string => entry !== null);

	if (pathspec.length === 0) {
		return succeeded('Nothing to stage', {createdCommit: false});
	}

	const changedAfterStageResult = trace(
		'hasStagedChanges(after stage)',
		await hasStagedChanges(stateBranchRoot, pathspec),
	);
	if (isFail(changedAfterStageResult)) {
		return failed(changedAfterStageResult.message);
	}

	logger.debug('[sync] state branch change check after stage result', {
		changed: changedAfterStageResult.value,
	});

	if (!changedAfterStageResult.value) {
		logger.info('[sync] no own event file changes to commit');
		return succeeded('No own event file changes to commit', {
			createdCommit: false,
		});
	}

	logger.debug('[sync] creating sync commit');

	const commitResult = trace(
		'createStateBranchSyncCommit',
		await createStateBranchSyncCommit({
			repoRoot,
			stateBranchRoot,
			pathspec,
		}),
	);
	if (isFail(commitResult)) return failed(commitResult.message);

	logger.debug('[sync] created sync commit', commitResult.value);

	return succeeded('Committed own event file', {
		createdCommit: true,
		commitSha: commitResult.value,
	});
};

const offlineSummary = (
	summary: Omit<SyncSummary, 'offline' | 'pulled' | 'pushed'>,
): Result<SyncSummary> => {
	const msg = summary.createdCommit ? 'Committed locally, offline' : 'Offline';

	setSyncOffline(msg);

	return succeeded(msg, {
		...summary,
		pulled: false,
		pushed: false,
		offline: true,
	});
};

const runSync = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	// ============================
	// Abort-guards
	// ============================
	logger.debug('[sync] syncEpiqWithRemote:start', {
		cwd,
		ownEventFileName,
	});

	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		logger.error(
			'[sync] invalid own event file name: contains path separator',
			{
				ownEventFileName,
			},
		);
		return failed('Own event file must be a file name, not a path');
	}

	if (!ownEventFileName.endsWith('.jsonl')) {
		logger.error('[sync] invalid own event file name: missing .jsonl suffix', {
			ownEventFileName,
		});
		return failed('Own event file must end with .jsonl');
	}

	// ============================
	// Update state
	// ============================
	setSyncing();

	// ============================
	// Ensure ready
	// ============================
	const ready = trace(
		'ensureSyncReady',
		await ensureSyncReady({
			cwd,
			ensureUpstream: true,
		}),
	);
	if (isFail(ready)) return failSync(ready.message);

	const {repoRoot, stateBranchRoot, bootstrapped} = ready.value;

	// ============================
	// Block on detached head
	// ============================
	const detachedResult = trace(
		'isDetachedHead(stateBranchRoot)',
		await isDetachedHead(stateBranchRoot),
	);
	if (isFail(detachedResult)) return failSync(detachedResult.message);

	logger.debug('[sync] detached state branch check result', {
		detached: detachedResult.value,
	});

	if (detachedResult.value) {
		return failSync(
			'Cannot run :sync while the state branch is in detached HEAD state',
		);
	}

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;

	// ============================
	// Commit local events before remote sync
	// ============================
	const stateBranchResult = trace('getStateBranch', getStateBranch(repoRoot));
	if (isFail(stateBranchResult)) return failSync(stateBranchResult.message);

	const stateBranch = stateBranchResult.value;

	logger.debug('[sync] resolved state branch', {
		stateBranch,
		stateBranchRoot,
	});

	const localCommitResult = trace(
		'commitOwnEventFileToStateBranch',
		await commitOwnEventFileToStateBranch({
			repoRoot,
			stateBranchRoot,
			ownEventFileName,
		}),
	);
	if (isFail(localCommitResult)) return failSync(localCommitResult.message);

	createdCommit = localCommitResult.value.createdCommit;
	commitSha = localCommitResult.value.commitSha;

	// ============================
	// Pull remote
	// ============================
	const pullResult = trace(
		'pullBranchRebaseIfPresent',
		await pullBranchRebaseIfPresent({
			cwd: stateBranchRoot,
			branch: stateBranch,
		}),
	);
	if (isFail(pullResult)) {
		if (isRemoteUnreachable(pullResult.message)) {
			return offlineSummary({
				repoRoot,
				stateBranchRoot,
				createdCommit,
				commitSha,
				bootstrapped,
			});
		}

		return failSync(pullResult.message);
	}

	pulled = pullResult.value;

	// ============================
	// Push remote
	// ============================
	// Checked after the pull, and not folded into `createdCommit`: a commit an
	// earlier run failed to push is still ours to send.
	const aheadResult = trace(
		'isAheadOfUpstream',
		await isAheadOfUpstream(stateBranchRoot),
	);
	if (isFail(aheadResult)) return failSync(aheadResult.message);

	if (createdCommit || bootstrapped || aheadResult.value) {
		logger.info('[sync] pushing state branch', {
			createdCommit,
			bootstrapped,
			stateBranchRoot,
		});

		let pushResult = trace(
			'pushStateBranch',
			await pushStateBranch({stateBranchRoot, repoRoot}),
		);

		if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
			const pullRetryResult = trace(
				'pullBranchRebaseIfPresent(retry)',
				await pullBranchRebaseIfPresent({
					cwd: stateBranchRoot,
					branch: stateBranch,
				}),
			);
			if (isFail(pullRetryResult)) return failSync(pullRetryResult.message);

			pulled = pulled || pullRetryResult.value;

			pushResult = trace(
				'pushStateBranch(retry)',
				await pushStateBranch({stateBranchRoot, repoRoot}),
			);
		}

		if (isFail(pushResult)) {
			if (isRemoteUnreachable(pushResult.message)) {
				return offlineSummary({
					repoRoot,
					stateBranchRoot,
					createdCommit,
					commitSha,
					bootstrapped,
				});
			}

			return failSync(pushResult.message);
		}

		pushed = pushResult.value;
	}

	// ============================
	// Resolve commit sha
	// ============================
	if (createdCommit) {
		logger.debug('[sync] resolving final sync commit sha', {
			stateBranchRoot,
		});

		const finalShaResult = trace(
			'git rev-parse HEAD',
			await execGit({
				args: ['rev-parse', 'HEAD'],
				cwd: stateBranchRoot,
			}),
		);

		if (isFail(finalShaResult)) {
			return failSync(finalShaResult.message);
		}

		commitSha = finalShaResult.value.stdout.trim();

		logger.debug('[sync] final sync commit sha', commitSha);
	}

	// ============================
	// Update state
	// ============================
	setSynced(
		pushed
			? 'Synced and pushed'
			: pulled || createdCommit
			? 'Synced local state'
			: 'Already synced',
	);

	logger.debug('[sync] syncEpiqWithRemote:done');

	return succeeded('Synced event logs with state branch', {
		repoRoot,
		stateBranchRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		bootstrapped,
		offline: false,
	});
};

/**
 * Runs the sync with the event logs on disk held to their one rule: they may
 * gain lines and lose none.
 *
 * Everything inside hands the worktree to git — a checkout, a `rebase
 * --abort`, an autostash reverting the working copy to HEAD and putting it
 * back — while other processes on this machine are appending to the same
 * directory with no lock of their own. Lines that were there when we took the
 * worktree and are not there when we give it back were lost by git, never
 * removed on purpose, so they go back.
 *
 * `finally`, because a sync that failed part-way is exactly when a rebase is
 * left half-applied.
 */
const withEventLogsIntact = async <T>(
	stateBranchRoot: string,
	fn: () => Promise<T>,
): Promise<T> => {
	const snapshot = snapshotEventLogs(stateBranchRoot);

	try {
		return await fn();
	} finally {
		const repaired = restoreDroppedEventLines(stateBranchRoot, snapshot);

		if (repaired.length > 0) {
			logger.error(
				`[sync] restored event log lines git dropped from the worktree: ${repaired.join(
					', ',
				)}`,
			);
		}
	}
};

/**
 * Only one process may drive the state worktree at a time.
 *
 * `runExclusive` covers a single process; this covers the several that share
 * one board — a TUI, a GUI autosync, an MCP server per agent. Without it,
 * bootstrap's `git rebase --abort` could not tell a live sync's rebase from one
 * a crashed process abandoned, and recovered from the second by destroying the
 * first.
 */
export const syncEpiqWithRemote = async (
	args: SyncArgs,
): Promise<Result<SyncSummary>> => {
	const cwd = args.cwd ?? process.cwd();

	const repoRootResult = await getRepoRootDir(cwd);
	if (isFail(repoRootResult)) return failSync(repoRootResult.message);

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});
	if (isFail(stateBranchRootResult)) {
		return failSync(stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	// There is no worktree to hold before bootstrap creates one. Two processes
	// racing a project's very first sync is a narrower window than this lock
	// addresses, and taking a lock inside a directory that does not exist yet
	// would need somewhere else to put it.
	if (!fs.existsSync(stateBranchRoot)) return runSync(args);

	const lockedResult = await withSyncLock({
		worktreeRoot: stateBranchRoot,
		operation: 'sync',
		fn: () => withEventLogsIntact(stateBranchRoot, () => runSync(args)),
	});
	if (isFail(lockedResult)) return failSync(lockedResult.message);

	// Held elsewhere. Reported as a skip rather than a failure: autosync runs
	// every few seconds, and a contended worktree is normal traffic, not an
	// error worth putting in front of the user each time.
	if (lockedResult.value === null) {
		return succeeded('Another process is syncing this board', {
			repoRoot: repoRootResult.value,
			stateBranchRoot,
			createdCommit: false,
			pulled: false,
			pushed: false,
			bootstrapped: false,
			offline: false,
			skipped: true,
		});
	}

	return lockedResult.value;
};
