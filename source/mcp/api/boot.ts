import fs from 'node:fs';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {execGit} from '../../git/git-utils.js';
import {getStateBranch} from '../../git/git-constants.js';
import {
	ensureLocalStateBranch,
	ensureStateBranchWorktree,
} from '../../git/git.js';
import {readGitEmail, readGitName} from '../../lib/config/git-identity.js';
import {loadSettingsFromConfig} from '../../lib/config/user-config.js';
import {patchSettingsState} from '../../lib/state/settings.state.js';
import {bootStateFromEventLog} from '../../lib/board/board-boot.js';
import {
	accountedSignature,
	accountFor,
	logSignature,
} from '../../lib/event/log-signature.js';
import {
	getEpiqDirPath,
	resolveClosestEpiqProjectRoot,
} from '../../lib/storage/paths.js';
import {loadMergedEventsWithUnreadable} from '../../lib/board/board-log.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {getSafeState, isStateInitialized} from '../../lib/state/state.js';
import {logger} from '../../logger.js';
import {getTimeTravelStatus} from '../epiq-time-travel.js';

export type ToolInput = {
	repoRoot?: string;
};

export type BootResult = {
	repoRoot: string;
	stateBranchRoot: string;
};

export type Actor = {
	userId: string;
	userName: string;
};

export const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

// The state branch and worktree, once seen in place: checking costs two
// subprocesses per call. Revalidated by the worktree directory still existing.
let ensuredBranch: {repoRoot: string; stateBranchRoot: string} | null = null;

export const boot = async (
	repoRoot?: string,
	options?: {pull?: boolean},
): Promise<Result<BootResult>> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	// This project's branch, which may not have the default name.
	const stateBranchResult = getStateBranch(repoRootResult.value);
	if (isFail(stateBranchResult)) return failed(stateBranchResult.message);

	const inPlace =
		ensuredBranch !== null &&
		ensuredBranch.repoRoot === repoRootResult.value &&
		ensuredBranch.stateBranchRoot === stateBranchRootResult.value &&
		fs.existsSync(getEpiqDirPath(stateBranchRootResult.value));

	if (!inPlace) {
		// A never-synced clone has no local state branch. Not the sync's full bootstrap,
		// which also commits repairs.
		const localBranchResult = await ensureLocalStateBranch({
			repoRoot: repoRootResult.value,
			stateBranchName: stateBranchResult.value,
		});

		if (isFail(localBranchResult)) return failed(localBranchResult.message);

		const ensureWorktreeResult = await ensureStateBranchWorktree({
			repoRoot: repoRootResult.value,
			stateBranchRoot: stateBranchRootResult.value,
			stateBranchName: stateBranchResult.value,
		});

		if (isFail(ensureWorktreeResult)) {
			return failed(ensureWorktreeResult.message);
		}

		ensuredBranch = {
			repoRoot: repoRootResult.value,
			stateBranchRoot: stateBranchRootResult.value,
		};
	}

	// MCP tools are local-only by default; fetching remote state is explicit.
	if (options?.pull ?? false) {
		const pullResult = await execGit({
			cwd: stateBranchRootResult.value,
			args: ['pull', '--ff-only'],
		});

		if (isFail(pullResult)) {
			logger.info(3, pullResult.message);
		}
	}

	const booted = {
		repoRoot: repoRootResult.value,
		stateBranchRoot: stateBranchRootResult.value,
	};

	// Fills the settings store from config, so the actor matches this process. Above the
	// skip: a `:config user` rename writes no event, so a skipping boot must still re-read config.
	const settings = loadSettingsFromConfig();
	if (!isFail(settings)) patchSettingsState(settings.value);

	// After the config load, which clears the git identity; the write path compares
	// it on every write.
	patchSettingsState({
		gitEmail: await readGitEmail(repoRootResult.value),
		gitName: await readGitName(repoRootResult.value),
	});

	// Before the load, never after — see log-signature for why that order is
	// the one that stays correct when another machine writes mid-read.
	const signature = logSignature(stateBranchRootResult.value);

	// Skips re-deriving an unchanged board. Only while live: a past checkout is
	// time travel's to materialize.
	if (
		accountedSignature(stateBranchRootResult.value) === signature &&
		isStateInitialized() &&
		getTimeTravelStatus().mode === 'live'
	) {
		return succeeded('Booted Epiq state, unchanged', booted);
	}

	const eventsResult = loadMergedEventsWithUnreadable(
		stateBranchRootResult.value,
	);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const bootResult = bootStateFromEventLog(
		eventsResult.value.events,
		eventsResult.value.unreadable,
	);
	if (isFail(bootResult)) return failed(bootResult.message);

	// Recorded after the boot, so a failed one is retried; writes then advance it.
	accountFor(stateBranchRootResult.value, signature);

	return succeeded('Booted Epiq state', booted);
};

export const getActor = (): Result<Actor> => {
	const actorResult = loadSettingsFromConfig();
	if (isFail(actorResult)) return failed(actorResult.message);

	if (!actorResult.value.userId) return failed('Unable to retrieve user id');
	if (!actorResult.value.userName) {
		return failed('Unable to retrieve user name');
	}

	return succeeded('Resolved actor', {
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
	});
};

export const getStateResult = () => {
	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed(stateResult.message);

	return stateResult;
};

/** Boots without touching the network, as every MCP tool must; syncing is `epiq_sync`'s job. */
export const bootLocal = (repoRoot?: string) => boot(repoRoot, {pull: false});

/**
 * Boots locally, then resolves the actor and the state, returning the first
 * failure. Also used by tools that only read but need to know whose.
 */
export const bootedWithActorAndState = async (repoRoot?: string) => {
	const bootResult = await bootLocal(repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	return succeeded('Booted', {
		boot: bootResult.value,
		actor: actorResult.value,
		state: stateResult.value,
	});
};
