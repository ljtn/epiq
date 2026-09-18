// What every ticket's commits add up to, for the bar beside its ref.
//
// One message for the whole board rather than one per card: the server reads
// the history once and buckets it by ref, so the cost is the same whether one
// card asks or forty. Asked for rather than broadcast, because a commit lands
// outside the event log — no state change announces it — and asked again when
// the window comes back to the front, which is when a commit made in the
// terminal a moment ago first matters here.

import {useCallback, useEffect, useRef, useState} from 'react';
// Types only, from a module that declares nothing but types and imports
// nothing at all — the same boundary `use-swimlane-stats` reads its own over.
import {RefDiffStats} from '../../../lib/stats/ref-diff-stats.model.js';
import {getResultValue} from './gui-state-helper';

// Module scope, so a board with no commits at all is handed one unchanging
// object rather than a fresh empty one on every render.
const NONE: RefDiffStats = {};

// The server holds its history scan for FULL_TIMELINE_CACHE_TTL_MS, so an ask
// inside this window is answered from that cache and costs nothing — and one
// just outside it is the ask worth making, since a commit that landed in the
// meantime is what the reader came back to see. Returning to the page fires
// focus every time, including on a click through from another window.
const REFRESH_AFTER_MS = 5_000;

export const useRefDiffStats = ({
	socketEpoch,
	sendRaw,
}: {
	// Counts opened sockets, so it is 0 before the first one is up and rises on
	// every reconnect — after which the socket that would have carried an
	// earlier answer is gone, and the question has to be put again.
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [stats, setStats] = useState<RefDiffStats>(NONE);
	const askedAt = useRef(0);

	const ask = useCallback(() => {
		askedAt.current = Date.now();
		sendRaw({type: 'diff-stats:get'});
	}, [sendRaw]);

	// Not at mount, only once a socket is up. Asking at mount as well would send
	// the same frame twice — it is queued through the connecting socket, and
	// that socket opening is itself what raises the epoch — and the server
	// answers both, the first of them on a cold cache.
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

		// A failure — no repository to read, a git lock held elsewhere — leaves
		// the bars as they are. They are a decoration on the board, and a column
		// of them blinking out says nothing the reader can act on.
		const next = getResultValue<RefDiffStats>(message.payload);
		if (next) setStats(next);
	}, []);

	return {stats, onMessage};
};
