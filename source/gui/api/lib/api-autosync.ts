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

export const startGuiAutoSync = (input: {
	project: GuiProject;
	publisher: LogPublisher;
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

		// Resolved, not the raw config: a machine that only has an environment
		// actor has a user to sync as even though `config.json` names nobody.
		// `autoSyncBlockedReason` reads the settings store this fills, and is
		// the same answer the identity panel shows beside the toggle.
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

		// Re-read rather than trusted to the arming: the preference can be
		// switched off from the identity panel while this pass is already on the
		// clock, and `queueSync` only declines to arm the *next* one.
		if (!isAutoSyncConfigured()) return;

		syncing = true;
		lastStartedAt = Date.now();

		try {
			// The live check must stay inside the lock, or a scrub lands in the gap
			// before the getGuiState broadcast silently overwrites it.
			await runExclusive(async () => {
				if (getTimeTravelStatus().mode !== 'live') return;

				await sync({repoRoot: input.project.repoRoot});

				// Whether the pass moved the log, not whether it succeeded: a pull that
				// landed before a refused push still changed the board.
				await input.publisher.publishIfLogMoved();
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
		/**
		 * Re-arms against the interval as it now stands.
		 *
		 * The delay is worked out when a timer is set, so a cadence shortened
		 * from an hour to three seconds would otherwise not be felt for an hour.
		 * Dropping the pending timer and asking again is the whole of it — a pass
		 * already running finishes and re-arms itself from the new value.
		 */
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
