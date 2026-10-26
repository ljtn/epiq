// A parked needle in the address bar, so a link or reload opens the same
// moment. Live writes no key; history gains an entry per release, not per step.

import {useCallback, useEffect, useRef} from 'react';
import {useNavigationType, useSearchParams} from 'react-router-dom';

const KEY = 'at';

export const readNeedleParam = (params: URLSearchParams): number | null => {
	const raw = params.get(KEY);
	if (raw === null || !/^\d+$/.test(raw)) return null;

	const at = Number(raw);

	return Number.isSafeInteger(at) ? at : null;
};

export const writeNeedleParam = (
	params: URLSearchParams,
	at: number | null,
): void => {
	if (at === null) {
		params.delete(KEY);
	} else {
		params.set(KEY, String(Math.round(at)));
	}
};

// Not yet read: the first URL is one to take the board to, like any other the
// browser hands over.
const UNREAD = Symbol('unread');

// After this, a release that moved nothing stops claiming the next write.
const SETTLE_MS = 2_000;

export const useNeedleUrl = ({
	cut,
	state,
	socketEpoch,
	following,
	dragging,
	scrubTo,
	goLive,
}: {
	// Where the board stands: a moment, or null for live.
	cut: number | null;
	// The board's state as last broadcast, or null before the first: `cut` is
	// the server's answer only once it has arrived.
	state: unknown;
	// Counts opened sockets. A new one may be a restarted server, which holds
	// no moment at all, so the URL is read again on the state it sends.
	socketEpoch: number;
	// False while a movie plays: it scrubs every frame, and is no moment to
	// link to.
	following: boolean;
	// A needle being dragged: the URL waits for where it is let go of.
	dragging: boolean;
	scrubTo: (at: number) => void;
	goLive: () => void;
}): {settle: () => void} => {
	const [searchParams, setSearchParams] = useSearchParams();
	const inUrl = readNeedleParam(searchParams);
	// Only Back, Forward or the load itself say where the board should be.
	const navigationType = useNavigationType();

	// What this hook last put in the URL. Any other value got there by a link,
	// a reload, or Back and Forward, and the board is taken to it.
	const written = useRef<number | null | typeof UNREAD>(UNREAD);
	// Set while heading to a moment the URL asked for, so the URL isn't
	// overwritten mid-scrub.
	const arriving = useRef<{from: number | null} | null>(null);
	// When the needle was last let go of: the next moment written soon after is
	// a new entry.
	const settledAt = useRef(0);

	const settle = useCallback(() => {
		settledAt.current = Date.now();
	}, []);

	const loaded = state !== null;
	// Read again on the first state a new socket brings, and otherwise only when
	// the URL itself has moved: a broadcast is no reason to look.
	const reread = useRef(false);
	const seen = useRef<number | null | typeof UNREAD>(UNREAD);

	useEffect(() => {
		reread.current = true;
	}, [socketEpoch]);

	useEffect(() => {
		if (!loaded) return;

		const fresh = reread.current;
		const moved = inUrl !== seen.current;
		reread.current = false;
		seen.current = inUrl;
		if (!fresh && !moved) return;

		if (fresh) written.current = UNREAD;
		if (inUrl === written.current) return;
		if (navigationType !== 'POP' && written.current !== UNREAD) return;

		// A page opened without a moment keeps the board's and writes it in; only
		// Back or Forward there means live.
		const firstRead = written.current === UNREAD;
		written.current = inUrl;
		if (inUrl === cut || (firstRead && inUrl === null)) return;

		arriving.current = {from: cut};
		if (inUrl === null) goLive();
		else scrubTo(inUrl);
	}, [state, inUrl]);

	useEffect(() => {
		if (!loaded || written.current === UNREAD) return;

		const arrival = arriving.current;
		if (arrival) {
			if (cut === arrival.from) return;
			arriving.current = null;
		}

		if (!following || dragging || cut === inUrl) return;

		const push = Date.now() - settledAt.current < SETTLE_MS;
		settledAt.current = 0;
		written.current = cut;

		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				writeNeedleParam(next, cut);
				return next;
			},
			{replace: !push},
		);
	}, [loaded, cut, inUrl, following, dragging]);

	return {settle};
};
