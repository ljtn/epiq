import React, {useEffect} from 'react';
import {reloadIfEventLogMoved} from '../../git/event-log-watch.js';

const EVENT_LOG_WATCH_INTERVAL_MS = 1_000;

/**
 * Runs `check` on a timer until stopped. The pause is at least as long as the
 * last run took: the replay runs on the render thread, and a busy sibling on a
 * large board must not keep the TUI replaying back to back.
 */
export const startEventLogWatch = (
	check: () => Promise<unknown>,
	intervalMs = EVENT_LOG_WATCH_INTERVAL_MS,
): (() => void) => {
	let timer: NodeJS.Timeout | undefined;
	let stopped = false;

	const tick = async () => {
		const startedAt = Date.now();

		try {
			await check();
		} catch (error) {
			// Unattended and on a timer: a throw here must not stop the watch.
			logger.error('[watch] reload threw', error);
		}

		if (stopped) return;

		timer = setTimeout(tick, Math.max(intervalMs, Date.now() - startedAt));
	};

	timer = setTimeout(tick, intervalMs);

	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
};

export const EventLogWatchController: React.FC = () => {
	useEffect(() => startEventLogWatch(reloadIfEventLogMoved), []);

	return null;
};
