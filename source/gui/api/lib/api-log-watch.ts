import {GuiProject} from './gui-project.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {isSyncLockHeldAt} from '../../../git/sync-lock.js';
import {logSignature} from '../../../lib/event/log-signature.js';
import {readConnectedRepos} from '../../../lib/commits/commits.js';
import {isFail} from '../../../lib/model/result-types.js';
import {startPacedWatch} from '../../../lib/utils/paced-watch.js';
import {resolveClosestEpiqProjectRoot} from '../../../lib/storage/paths.js';
import {getGuiState} from '../../../mcp/epiq-api.js';
import {
	getTimeTravelStatus,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {broadcastGuiMessage} from '../../client/lib/gui-broadcast.js';
import {slimStateResult} from './slim-state.js';

const LOG_WATCH_INTERVAL_MS = 1_000;

// Walks up like every other read on this path: the GUI may have been launched
// in a subdirectory of the project.
const stateBranchRootOf = (project: GuiProject): string | null => {
	const projectRoot = resolveClosestEpiqProjectRoot(project.repoRoot);
	if (isFail(projectRoot)) return null;

	const stateBranchRoot = getStateBranchRoot({repoRoot: projectRoot.value});

	return isFail(stateBranchRoot) ? null : stateBranchRoot.value;
};

/**
 * Publishes the board when the log on disk moved, not when a sync says so:
 * other processes (TUI, MCP) append to the same worktree.
 */
export const createLogPublisher = (input: {project: GuiProject}) => {
	const currentSignature = (): string | null => {
		const stateBranchRoot = stateBranchRootOf(input.project);

		return stateBranchRoot === null ? null : logSignature(stateBranchRoot);
	};

	// The connected repos as last published: a pulled or another process's
	// connect, edit or disconnect moves the list without moving any commit.
	const reposOf = (): string | null => {
		const repos = readConnectedRepos(input.project.repoRoot);
		return isFail(repos)
			? null
			: JSON.stringify([repos.value.live, repos.value.overLimit]);
	};
	let publishedRepos = reposOf();

	// Recorded before the derive: an underivable log is retried only once it changes.
	let attempted: string | null = currentSignature();

	/** For a caller inside `runExclusive`; an unchanged log is not republished. */
	const publishIfLogMoved = async (): Promise<void> => {
		const stateBranchRoot = stateBranchRootOf(input.project);
		if (stateBranchRoot === null) return;

		// Git may have lines off the logs until the sync restores them.
		if (await isSyncLockHeldAt(stateBranchRoot)) return;

		const signature = logSignature(stateBranchRoot);
		if (signature === attempted) return;
		attempted = signature;

		const payload = slimStateResult(
			await getGuiState({repoRoot: input.project.repoRoot}),
		);

		// A log that cannot be derived — mid-rebase, half-written — is not sent
		// as an error in place of the board the clients hold.
		if (isFail(payload)) return;

		broadcastGuiMessage({type: 'state', payload});

		const repos = reposOf();
		if (repos !== null && repos !== publishedRepos) {
			publishedRepos = repos;
			broadcastGuiMessage({type: 'repos:changed'});
		}
	};

	return {publishIfLogMoved};
};

export type LogPublisher = ReturnType<typeof createLogPublisher>;

/** Publishes other processes' writes, autosync or not: reading the local worktree costs no network. */
export const startGuiLogWatch = (
	publisher: LogPublisher,
	intervalMs = LOG_WATCH_INTERVAL_MS,
): (() => void) =>
	startPacedWatch(
		() =>
			runExclusive(async () => {
				// Inside the lock, or a scrub lands in the gap and the broadcast
				// overwrites it.
				if (getTimeTravelStatus().mode !== 'live') return;

				await publisher.publishIfLogMoved();
			}),
		intervalMs,
	);
