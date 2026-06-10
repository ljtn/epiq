import {getSettingsState} from '../../../lib/state/settings.state.js';
import {getGuiState, sync} from '../../../mcp/epiq-api.js';
import {broadcastGuiMessage} from '../../client/lib/gui-broadcast.js';

export const startGuiAutoSync = (input: {repoRoot: string}) => {
	let intervalTimer: NodeJS.Timeout | undefined;
	let debounceTimer: NodeJS.Timeout | undefined;
	let disposed = false;
	let syncing = false;
	let pending = false;

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

		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			void runSync();
		}, delayMs);
	};

	const scheduleInterval = () => {
		if (disposed) return;

		const {autoSyncIntervalMs, userName, preferredEditor} = getSettingsState();

		intervalTimer = setTimeout(() => {
			const settingsReady = Boolean(
				getSettingsState().preferredEditor &&
					getSettingsState().userName &&
					getSettingsState().autoSyncIntervalMs,
			);

			if (settingsReady) {
				void runSync();
			}

			scheduleInterval();
		}, autoSyncIntervalMs || 5_000);

		if (!preferredEditor || !userName || !autoSyncIntervalMs) return;
	};

	scheduleInterval();

	return {
		scheduleSync,
		dispose: () => {
			disposed = true;

			if (intervalTimer) clearTimeout(intervalTimer);
			if (debounceTimer) clearTimeout(debounceTimer);
		},
	};
};
