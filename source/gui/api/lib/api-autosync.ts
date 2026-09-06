import {GuiProject} from './gui-project.js';
import {getStateBranchRoot} from '../../../git/git-storage.js';
import {
	loadSettingsFromConfig,
	readEpiqConfig,
} from '../../../lib/config/user-config.js';
import {logSignature} from '../../../lib/event/log-signature.js';
import {isFail} from '../../../lib/model/result-types.js';
import {logger} from '../../../logger.js';
import {getGuiState, sync} from '../../../mcp/epiq-api.js';
import {
	getTimeTravelStatus,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {broadcastGuiMessage} from '../../client/lib/gui-broadcast.js';
import {slimStateResult} from './slim-state.js';

const DEFAULT_INTERVAL_MS = 15_000;

export const startGuiAutoSync = (input: {project: GuiProject}) => {
	let timer: NodeJS.Timeout | undefined;
	let disposed = false;
	let syncing = false;
	let lastStartedAt = 0;

	// The log every client has been sent. Compared against the log on disk after
	// each pass, so what decides a broadcast is whether the board changed — not
	// whether git reported the pass a success. A pull that landed before a push
	// was refused, a remote that came back, an agent appending to the same
	// worktree: all of them move the log and none of them move the sync result.
	let published: string | null = currentSignature();

	function currentSignature(): string | null {
		const stateBranchRoot = getStateBranchRoot({
			repoRoot: input.project.repoRoot,
		});

		return isFail(stateBranchRoot) ? null : logSignature(stateBranchRoot.value);
	}

	const config = () => {
		const result = readEpiqConfig();
		if (isFail(result)) {
			logger.error(result.message);
			return null;
		}

		return result.value;
	};

	const isAutoSyncConfigured = () => {
		const settings = config();
		if (!settings) return false;

		const {autoSync, preferredEditor} = settings;
		// Resolved, not the raw config: a machine that only has an environment
		// actor has a user to sync as even though `config.json` names nobody.
		const resolved = loadSettingsFromConfig();
		const userName = isFail(resolved) ? null : resolved.value.userName;

		return Boolean(autoSync && userName && preferredEditor);
	};

	// One cadence for both the periodic pass and the one a mutation asks for, so
	// a burst of edits cannot sync faster than the configured interval.
	const delayUntilNextRun = () => {
		const intervalMs = config()?.autoSyncDebounceMs ?? DEFAULT_INTERVAL_MS;

		return Math.max(0, intervalMs - (Date.now() - lastStartedAt));
	};

	const runSync = async (): Promise<void> => {
		if (disposed || syncing) return;

		syncing = true;
		lastStartedAt = Date.now();

		try {
			// The live check must stay inside the lock, or a scrub lands in the gap
			// before the getGuiState broadcast silently overwrites it.
			await runExclusive(async () => {
				if (getTimeTravelStatus().mode !== 'live') return;

				await sync({repoRoot: input.project.repoRoot});

				// Publishing replaces every client's board wholesale, discarding
				// whatever the user was part-way through. An unchanged log is not
				// worth that; a failed sync over a changed one is.
				const signature = currentSignature();
				if (signature === null || signature === published) return;

				const payload = slimStateResult(
					await getGuiState({repoRoot: input.project.repoRoot}),
				);

				// A log that cannot be derived yet — mid-rebase, half-written — is
				// left for the next pass; the board the clients hold is better than
				// an error in its place.
				if (isFail(payload)) return;

				published = signature;
				broadcastGuiMessage({type: 'state', payload});
			});
		} finally {
			syncing = false;
			// Always re-arms, so a request that arrived mid-run is covered by the
			// next pass rather than needing a queue of its own.
			queueSync();
		}
	};

	function queueSync(): void {
		if (disposed || !isAutoSyncConfigured()) return;

		if (syncing || timer) return;

		timer = setTimeout(() => {
			timer = undefined;
			void runSync();
		}, delayUntilNextRun());
	}

	queueSync();

	return {
		queueSync,
		dispose: () => {
			disposed = true;

			if (timer) clearTimeout(timer);
		},
	};
};
