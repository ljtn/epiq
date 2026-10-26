// Every ticket's commit totals, for the bar beside its ref. Asked for whole, again
// on focus (commits announce nothing), never per moment: a scrub sums them here.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
// Types only, from a module that declares nothing but types and imports
// nothing at all — the same boundary `use-swimlane-stats` reads its own over.
import {RefDiffTimeline} from '../../../lib/stats/ref-diff-stats.model.js';
import {getResultValue} from './gui-state-helper';
import {diffStatsAt} from './ref-diff-at';

// Module scope, so a board with no commits at all is handed one unchanging
// object rather than a fresh empty one on every render.
const NONE: RefDiffTimeline = {};

// Matches the server's FULL_TIMELINE_CACHE_TTL_MS: an ask inside it is a cache
// hit, one past it can see a new commit.
const REFRESH_AFTER_MS = 5_000;

export const useRefDiffStats = ({
	socketEpoch,
	asOfTime,
	sendRaw,
}: {
	// The needle of a scrubbed board, or null when live: only commits made by
	// then count.
	asOfTime: number | null;
	// Rises on every reconnect, when the question must be put again.
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [timeline, setTimeline] = useState<RefDiffTimeline>(NONE);
	const askedAt = useRef(0);

	const ask = useCallback(() => {
		askedAt.current = Date.now();
		sendRaw({type: 'diff-stats:get'});
	}, [sendRaw]);

	// Only once a socket is up: asking at mount too would send it twice.
	useEffect(() => {
		if (socketEpoch === 0) return;

		ask();
	}, [socketEpoch, ask]);

	useEffect(() => {
		const refresh = () => {
			if (document.visibilityState === 'hidden') return;
			if (Date.now() - askedAt.current < REFRESH_AFTER_MS) return;

			ask();
		};

		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);

		return () => {
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	}, [ask]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'diff-stats') return;

		// A failure leaves the bars as they are.
		const next = getResultValue<RefDiffTimeline>(message.payload);
		if (next) setTimeline(next);
	}, []);

	const stats = useMemo(
		() => diffStatsAt(timeline, asOfTime),
		[timeline, asOfTime],
	);

	return {stats, onMessage};
};
