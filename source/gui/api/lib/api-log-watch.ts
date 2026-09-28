import {GuiProject} from './gui-project.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {isSyncLockHeldAt} from '../../../git/sync-lock.js';
import {logSignature} from '../../../lib/event/log-signature.js';
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
 * Publishes the board to every client when the log moved since the last
 * publish. What decides it is the log on disk, never what a sync reported:
 * another process on this machine (the TUI, an agent's MCP) appends to the
 * same worktree without telling this one.
 */
export const createLogPublisher = (input: {project: GuiProject}) => {
	const currentSignature = (): string | null => {
		const stateBranchRoot = stateBranchRootOf(input.project);

		return stateBranchRoot === null ? null : logSignature(stateBranchRoot);
	};

	// Recorded before the derive, not after it succeeds: a log that cannot be
	// derived is tried again only once it changes, which is also the only time
	// its outcome can change.
	let attempted: string | null = currentSignature();

	/**
	 * For a caller inside `runExclusive` on the live board. Publishing replaces
	 * every client's board wholesale, so an unchanged log is not worth it.
	 */
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
	};

	return {publishIfLogMoved};
};

export type LogPublisher = ReturnType<typeof createLogPublisher>;

/**
 * Publishes other processes' writes whether or not autosync is on: reading
 * this machine's own worktree costs no network.
 */
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
