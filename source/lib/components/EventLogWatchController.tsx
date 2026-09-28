import React, {useEffect} from 'react';
import {reloadIfEventLogMoved} from '../../git/event-log-watch.js';
import {startPacedWatch} from '../utils/paced-watch.js';

const EVENT_LOG_WATCH_INTERVAL_MS = 1_000;

export const EventLogWatchController: React.FC = () => {
	useEffect(
		() => startPacedWatch(reloadIfEventLogMoved, EVENT_LOG_WATCH_INTERVAL_MS),
		[],
	);

	return null;
};
