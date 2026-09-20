import fs from 'node:fs';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {
	failSync,
	setSynced,
	setSyncing,
	setSyncOffline,
} from '../lib/state/sync-state.js';
import {ownEventFileNames} from '../lib/event/event-persist.js';
import {getEventsDirPath} from '../lib/storage/paths.js';
import {trace} from '../lib/utils/logger.utils.js';
import {getStateBranch} from './git-constants.js';
import {
	ensureStateBranchLayout,
	getRepoRootDir,
	getStateBranchRoot,
} from './git-storage.js';
import {
	abortRebaseIfPresent,
	clearStaleGitLocks,
	execGit,
	getInProgressGitOperation,
	hasRemote,
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
	stageStateBranchEventConfig,
	stageStateBranchMediaFiles,
	stageStateBranchOwnEventFile,
} from './git.js';
import {restoreDroppedEventLines, snapshotEventLogs} from './log-integrity.js';
import {flushPendingLogs} from '../lib/event/pending-log.js';
import {LockClaim, SYNC_LOCK_FILE, withSyncLock} from './sync-lock.js';

type SyncSummary = {
	repoRoot: string;
	stateBranchRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	bootstrapped: boolean;
	// Local work is committed; the remote could not be reached, or there is
	// none to reach.
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
	claim,
	cwd,
	ensureUpstream,
}: {
	// How this process came to hold the worktree. Only `clean` and `dead` say
	// nobody else is in it; see the recovery below.
	claim: LockClaim;
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

	// Before anything touches the worktree, because the first thing bootstrap
	// does is check out the state branch, and a `index.lock` left by a killed
	// git stops that with "Another git process seems to be running" — which is
	// how a crash used to wedge a board for good (`TATEM5B`).
	//
	// That nobody is running it has to be known rather than assumed, because
	// unwinding a live rebase is the very failure `sync-lock.ts` was written to
	// stop. Two things make it knowable: this runs under that lock, and the lock
	// says how it was come by. `clean` or `dead` means the previous holder is
	// gone and the operating system said so. `stale` means a live process's
	// claim was broken on age alone — its worktree is not ours to touch, and the
	// refusal below stands for that case exactly as it did before.
	if (claim !== 'stale' && fs.existsSync(stateBranchRoot)) {
		// Git takes `<file>.lock` before writing `<file>` and removes it after; a
		// process killed in between leaves it, and every later git refuses.
		// Every `.lock` here is a dead writer's, with one exception: our own
		// claim over this worktree, which lives in the same directory and ends
		// the same way.
		const locksResult = await clearStaleGitLocks(stateBranchRoot, {
			preserve: [SYNC_LOCK_FILE],
		});
		if (isFail(locksResult)) return failed(locksResult.message);

		if (locksResult.value.length > 0) {
			logger.info('[sync] cleared git lock files left by a dead process', {
				removed: locksResult.value,
				stateBranchRoot,
			});
		}

		// Abort rather than `--quit` or removing the state directory: a rebase
		// autostashes the appends made while it ran, and only abort puts them
		// back. It returns to the pre-rebase HEAD, which still carries every
		// local commit, so the pull further down simply starts the rebase again.
		// A rebase that will not unwind reports its own failure, naming the
		// worktree.
		const abortResult = trace(
			'abortRebaseIfPresent(stateBranchRoot)',
			await abortRebaseIfPresent(stateBranchRoot),
		);
		if (isFail(abortResult)) return failed(abortResult.message);
	}

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
		'getInProgressGitOperation(stateBranchRoot)',
		await getInProgressGitOperation(stateBranchRoot),
	);
	if (isFail(stateOpResult)) return failed(stateOpResult.message);

	logger.debug('[sync] state branch git operation check result', {
		inProgress: stateOpResult.value,
	});

	if (stateOpResult.value !== null) {
		// Whatever is still here after the clearing above is not this process's
		// to force: a merge, which sync never starts, so it came from outside
		// epiq — or anything at all when the claim was `stale` and nothing was
		// cleared. It says where, now, because the answer is a git command run
		// in a directory the reader has no reason to know about.
		logger.info('[sync] state branch git operation in progress', {claim});

		return failed(
			`Cannot sync while there is a ${stateOpResult.value} in the state ` +
				`branch at ${stateBranchRoot}`,
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

	// Every log this actor owns, not just the one they write to now. A machine
	// upgraded across ZFZFW9D still holds its older `<id>.<name>.jsonl`, and a
	// line flushed into that one but never committed would otherwise sit there
	// unstaged for good. Each is checked and staged on its own; one that has
	// not changed stages nothing.
	const stagedOwnPaths: (string | null)[] = [];

	for (const fileName of ownEventFileNames(
		getEventsDirPath(stateBranchRoot),
		ownEventFileName,
	)) {
		const stageResult = trace(
			'stageStateBranchOwnEventFile',
			await stageStateBranchOwnEventFile({
				stateBranchRoot,
				eventFileName: fileName,
			}),
		);
		if (isFail(stageResult)) return failed(stageResult.message);

		stagedOwnPaths.push(stageResult.value);
	}

	const stageMediaResult = trace(
		'stageStateBranchMediaFiles',
		await stageStateBranchMediaFiles({stateBranchRoot}),
	);
	if (isFail(stageMediaResult)) return failed(stageMediaResult.message);

	const stageConfigResult = trace(
		'stageStateBranchEventConfig',
		await stageStateBranchEventConfig({stateBranchRoot}),
	);
	if (isFail(stageConfigResult)) {
		return failed(stageConfigResult.message);
	}

	const pathspec = [
		...stagedOwnPaths,
		stageMediaResult.value,
		...stageConfigResult.value,
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
	reason: 'offline' | 'no remote' = 'offline',
): Result<SyncSummary> => {
	const msg = summary.createdCommit
		? `Committed locally, ${reason}`
		: reason === 'offline'
		? 'Offline'
		: 'No remote';

	setSyncOffline(msg);

	return succeeded(msg, {
		...summary,
		pulled: false,
		pushed: false,
		offline: true,
	});
};

const runSync = async (
	{cwd = process.cwd(), ownEventFileName}: SyncArgs,
	claim: LockClaim,
): Promise<Result<SyncSummary>> => {
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
			claim,
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

	// Everything this actor wrote since the last sync lives in a pending file,
	// which git does not track and therefore cannot reset out from under a
	// writer. Folded in here: this process holds the worktree, and it is before
	// the commit, so the lines go out with this sync rather than waiting for the
	// next one. Own file only — the commit below takes nothing else, and other
	// actors' lines are safer left pending than dirty in a tracked file.
	//
	// Not fatal on its own. The lines are still on disk and the next sync will
	// try again — refusing to sync at all would strand them further.
	const flushResult = trace(
		'flushPendingLogs',
		flushPendingLogs(stateBranchRoot, ownEventFileName),
	);
	if (isFail(flushResult)) {
		logger.error(`[sync] ${flushResult.message}`);
	}

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
	// A repository with no origin is a local-only board, not a broken one:
	// nothing to pull or push, and nothing to fail on every autosync tick.
	const remoteResult = trace(
		'hasRemote',
		await hasRemote({repoRoot: stateBranchRoot}),
	);
	if (isFail(remoteResult)) return failSync(remoteResult.message);

	if (!remoteResult.value) {
		return offlineSummary(
			{repoRoot, stateBranchRoot, createdCommit, commitSha, bootstrapped},
			'no remote',
		);
	}

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
export const withEventLogsIntact = async <T>(
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
	// Nothing to hold and nothing to recover: the worktree does not exist yet,
	// so there is no lock to take and no rebase anybody could have left in it.
	if (!fs.existsSync(stateBranchRoot)) return runSync(args, 'clean');

	const lockedResult = await withSyncLock({
		worktreeRoot: stateBranchRoot,
		operation: 'sync',
		fn: claim =>
			withEventLogsIntact(stateBranchRoot, () => runSync(args, claim)),
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
