import {readEpiqConfig} from '../../../lib/config/user-config.js';
import {isFail} from '../../../lib/model/result-types.js';
import {logger} from '../../../logger.js';
import {getGuiState, sync} from '../../../mcp/epiq-api.js';
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
			await sync({repoRoot: input.repoRoot});

			broadcastGuiMessage({
				type: 'state',
				payload: await getGuiState({repoRoot: input.repoRoot}),
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
