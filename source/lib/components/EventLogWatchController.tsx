import React, {useEffect} from 'react';
import {reloadIfEventLogMoved} from '../../git/event-log-watch.js';

// A directory listing and a stat per log file, so a second is a cheap cadence
// — and about as fast as a collaborator's write can matter to somebody
// watching the board.
const EVENT_LOG_WATCH_INTERVAL_MS = 1_000;

export const EventLogWatchController: React.FC = () => {
	useEffect(() => {
		const id = setInterval(reloadIfEventLogMoved, EVENT_LOG_WATCH_INTERVAL_MS);

		return () => clearInterval(id);
	}, []);

	return null;
};
