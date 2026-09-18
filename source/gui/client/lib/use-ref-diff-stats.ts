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

// A second ask inside this window would only land on the server's own cached
// read of the same history. Returning to the page fires focus every time,
// including on a click through from another window.
const REFRESH_AFTER_MS = 10_000;

export const useRefDiffStats = ({
	socketEpoch,
	sendRaw,
}: {
	// A reconnect: the socket that would have carried an earlier answer is gone,
	// so the question has to be put again.
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [stats, setStats] = useState<RefDiffStats>(NONE);
	const askedAt = useRef(0);

	const ask = useCallback(() => {
		askedAt.current = Date.now();
		sendRaw({type: 'diff-stats:get'});
	}, [sendRaw]);

	useEffect(() => {
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
