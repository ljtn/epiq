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

// The state branch and its worktree, once this process has seen them in place.
//
// Both checks spawn a subprocess, about 160ms for the pair, and every read and
// every write runs them before doing anything. What they guard against is a
// first call: a clone that never synced has no local branch for the worktree to
// attach to. Neither comes and goes under a running server.
//
// Revalidated by looking for the worktree's own directory, which is what
// disappears when another process relocates it — cheap enough to do every time,
// and the case those checks would otherwise be catching.
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

	// This project's branch. `getProjectFileContents()` mints a fresh descriptor
	// carrying the default name, so any project that named its state branch
	// something else was ignored.
	const stateBranchResult = getStateBranch(repoRootResult.value);
	if (isFail(stateBranchResult)) return failed(stateBranchResult.message);

	const inPlace =
		ensuredBranch !== null &&
		ensuredBranch.repoRoot === repoRootResult.value &&
		ensuredBranch.stateBranchRoot === stateBranchRootResult.value &&
		fs.existsSync(getEpiqDirPath(stateBranchRootResult.value));

	if (!inPlace) {
		// A clone that has never synced has no local state branch for the
		// worktree to attach to. Deliberately not the full bootstrap the sync
		// path runs: that also repairs the branch's contents with a commit.
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

	// What the TUI does on start-up and the GUI in its init: fill the settings
	// store, so anything resolving the actor through it agrees with this
	// process's identity.
	//
	// Above the skip below, not after it. The skip is about not deriving the
	// board twice; the identity is read from config, which the board's
	// signature says nothing about. Left below it, a process whose own writes
	// keep the signature accounted for would never re-read config at all, and a
	// name changed with `:config user` — which writes no event — would never
	// reach the board from that process again, because `ensureContributorCurrent`
	// would go on comparing the old name against itself.
	const settings = loadSettingsFromConfig();
	if (!isFail(settings)) patchSettingsState(settings.value);

	// After the config load, which clears it: config knows nothing about git, so
	// the address is a fact about the repository this process booted in. Read
	// once here because the write path compares it on every write.
	patchSettingsState({
		gitEmail: await readGitEmail(repoRootResult.value),
		gitName: await readGitName(repoRootResult.value),
	});

	// Before the load, never after — see log-signature for why that order is
	// the one that stays correct when another machine writes mid-read.
	const signature = logSignature(stateBranchRootResult.value);

	// Reading the board should not mean deriving it again. Every call came
	// through here re-reading the whole log and replaying every event: on a
	// twenty-person decade that is 169 MB and 960,000 events, about eight
	// seconds, for a board that had not changed since the last request a moment
	// earlier.
	//
	// Only while live. A checkout in the past is materialized by the time-travel
	// path and would be thrown away by a boot; `bootStateFromEventLog` refuses
	// that case too, and skipping must not quietly take its place.
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

	// Recorded after the boot, so a failed one is retried rather than remembered
	// as done. From here on a write advances this rather than invalidating it:
	// the process applied what it wrote, so it does not have to read it back.
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

/**
 * Boots a project the way every MCP tool must: without touching the network.
 *
 * The option lives here and nowhere else. Thirty-seven call sites each spelling
 * out `{pull: false}` is thirty-seven chances for one of them to stop saying
 * it, and a tool that quietly pulled would put a network round trip — and
 * another clone's writes — inside a call its caller believes is a local read.
 * Syncing is `epiq_sync`'s job, and the autosync loop's; both announce it.
 */
export const bootLocal = (repoRoot?: string) => boot(repoRoot, {pull: false});

/**
 * The prologue a tool runs before it can read or write the board: the project
 * booted locally, the actor to attribute anything it writes to, and the state
 * to read or apply it to. Any of the three failing is the tool's own answer, so
 * this hands back the first failure untouched.
 *
 * Named for what it fetches rather than for writing: three tools that write
 * nothing — the contributor list, the personal stats, the email suggestions —
 * need the actor to answer *whose*, and a name saying "mutation" would have
 * them read as writers to anyone auditing what touches the board.
 *
 * Twenty-seven tools had this written out apiece, six lines at a time. The
 * order matters — booting is what makes an actor and a state readable at all —
 * and an order stated once cannot be got wrong in the twenty-eighth.
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
