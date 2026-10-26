import {LogPublisher} from './api-log-watch.js';
import {GuiProject} from './gui-project.js';
import {effectiveAutoSyncIntervalMs} from '../../../lib/config/auto-sync-interval.js';
import {autoSyncBlockedReason} from '../../../lib/config/sync-settings.js';
import {
	loadSettingsFromConfig,
	readEpiqConfig,
} from '../../../lib/config/user-config.js';
import {isFail} from '../../../lib/model/result-types.js';
import {logger} from '../../../logger.js';
import {sync} from '../../../mcp/epiq-api.js';
import {
	getTimeTravelStatus,
	runExclusive,
} from '../../../mcp/epiq-time-travel.js';

// The other repos move on somebody else's push, not on this board's edits,
// so they need no fresher than this.
const REPO_FETCH_INTERVAL_MS = 60_000;

export const startGuiAutoSync = (input: {
	project: GuiProject;
	publisher: LogPublisher;
	/** Fetches the other repos after a board sync, skipping any fetched within `minIntervalMs`. */
	onReposFetch?: (minIntervalMs: number) => Promise<void>;
}) => {
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

		// Resolved, not raw config: an environment-only actor still has a user to sync as.
		const resolved = loadSettingsFromConfig();
		if (isFail(resolved)) return false;

		return (
			Boolean(settings.autoSync) &&
			autoSyncBlockedReason(resolved.value) === null
		);
	};

	// One cadence for both the periodic pass and the one a mutation asks for, so
	// a burst of edits cannot sync faster than the configured interval.
	const delayUntilNextRun = () => {
		const intervalMs = effectiveAutoSyncIntervalMs(
			config()?.autoSyncDebounceMs,
		);

		return Math.max(0, intervalMs - (Date.now() - lastStartedAt));
	};

	const runSync = async (): Promise<void> => {
		if (disposed || syncing) return;

		// Re-read: autosync may have been switched off while this pass was armed.
		if (!isAutoSyncConfigured()) return;

		syncing = true;
		lastStartedAt = Date.now();

		try {
			// The live check must stay inside the lock, or a scrub lands in the gap
			// before the getGuiState broadcast silently overwrites it.
			const synced = await runExclusive(async () => {
				if (getTimeTravelStatus().mode !== 'live') return false;

				const result = await sync({repoRoot: input.project.repoRoot});

				// Whether the pass moved the log, not whether it succeeded: a pull that
				// landed before a refused push still changed the board.
				await input.publisher.publishIfLogMoved();
				return !isFail(result);
			});

			// Outside the lock and not awaited: a first clone must not hold up the board.
			if (synced) void input.onReposFetch?.(REPO_FETCH_INTERVAL_MS);
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
		/** Re-arms against the current interval; an armed timer holds the old delay. */
		reschedule: () => {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}

			queueSync();
		},
		dispose: () => {
			disposed = true;

			if (timer) clearTimeout(timer);
		},
	};
};
