import {readEpiqConfig} from '../../../lib/config/user-config.js';
import {isFail} from '../../../lib/model/result-types.js';
import {logger} from '../../../logger.js';
import {getGuiState, sync} from '../../../mcp/epiq-api.js';
import {
	getTimeTravelStatus,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';
import {broadcastGuiMessage} from '../../client/lib/gui-broadcast.js';

const DEFAULT_INTERVAL_MS = 15_000;

export const startGuiAutoSync = (input: {repoRoot: string}) => {
	let timer: NodeJS.Timeout | undefined;
	let disposed = false;
	let syncing = false;
	let lastStartedAt = 0;

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

		const {autoSync, userName, preferredEditor} = settings;
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

				const result = await sync({repoRoot: input.repoRoot});
				if (isFail(result)) return;

				const {pulled, createdCommit, bootstrapped} = result.value;

				// Publishing replaces every client's board wholesale, discarding
				// whatever the user was part-way through. An unchanged repository is
				// not worth that.
				if (!pulled && !createdCommit && !bootstrapped) return;

				broadcastGuiMessage({
					type: 'state',
					payload: await getGuiState({repoRoot: input.repoRoot}),
				});
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
