import {readEpiqConfig} from '../../../lib/config/user-config.js';
import {isFail} from '../../../lib/model/result-types.js';
import {logger} from '../../../logger.js';
import {getGuiState, sync} from '../../../mcp/epiq-api.js';
import {getTimeTravelStatus, runExclusive} from '../../../mcp/epiq-time-travel.js';
import {broadcastGuiMessage} from '../../client/lib/gui-broadcast.js';

export const startGuiAutoSync = (input: {repoRoot: string}) => {
	let intervalTimer: NodeJS.Timeout | undefined;
	let debounceTimer: NodeJS.Timeout | undefined;
	let disposed = false;
	let syncing = false;
	let pending = false;

	const isAutoSyncConfigured = () => {
		const configRes = readEpiqConfig();
		if (isFail(configRes)) return logger.error(configRes.message);
		const {autoSync, userName, preferredEditor} = configRes.value;

		return Boolean(autoSync && userName && preferredEditor);
	};

	const runSync = async () => {
		if (disposed) return;

		if (syncing) {
			pending = true;
			return;
		}

		syncing = true;

		try {
			// Share the same lock checkoutStateAt/returnToLive use (epiq-time-travel.ts),
			// so a scrub can never land in the gap between "still live?" and the
			// getGuiState() that would otherwise silently overwrite it — whichever
			// operation is queued first now runs to completion (including its
			// broadcast) before the other starts, and the live-mode check below is
			// taken fresh at the moment we actually get to run, not before queueing.
			await runExclusive(async () => {
				if (getTimeTravelStatus().mode !== 'live') return;

				await sync({repoRoot: input.repoRoot});

				broadcastGuiMessage({
					type: 'state',
					payload: await getGuiState({repoRoot: input.repoRoot}),
				});
			});
		} finally {
			syncing = false;

			if (pending) {
				pending = false;
				void runSync();
			}
		}
	};

	const scheduleSync = (delayMs = 750) => {
		if (disposed) return;

		if (debounceTimer) clearTimeout(debounceTimer);

		debounceTimer = setTimeout(() => {
			void runSync();
		}, delayMs);
	};

	const scheduleIntervalSync = () => {
		if (disposed) return;

		const configRes = readEpiqConfig();
		if (isFail(configRes)) return logger.error(configRes.message);
		const {autoSyncDebounceMs} = configRes.value;

		if (!isAutoSyncConfigured()) return;

		intervalTimer = setTimeout(() => {
			void runSync();
			scheduleIntervalSync();
		}, autoSyncDebounceMs ?? 15_000);
	};

	scheduleIntervalSync();

	return {
		scheduleSync,
		dispose: () => {
			disposed = true;

			if (intervalTimer) clearTimeout(intervalTimer);
			if (debounceTimer) clearTimeout(debounceTimer);
		},
	};
};
