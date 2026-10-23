// A parked needle in the address bar, so a link or a reload opens the board at
// the same moment. Its own key rather than part of the board selection: any
// selection key makes the URL authoritative for all of them, and a moment is
// not a way of looking at the board.
//
// Only a parked needle is written. A live one leaves the key off, so a reload
// keeps following now rather than freezing at the moment it was made.
//
// History gains an entry where the needle is let go of, never one per step of
// a drag, and Back and Forward take the board to the moment they land on.

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

// How long a release waits for its moment to land before the next write stops
// counting as its own: a click on the spot the needle already stands on moves
// nothing, and must not turn some later write into a history entry.
const SETTLE_MS = 2_000;

export const useNeedleUrl = ({
	cut,
	loaded,
	following,
	dragging,
	scrubTo,
	goLive,
}: {
	// Where the board stands: a moment, or null for live.
	cut: number | null;
	// Whether the board's state has arrived, so `cut` is the server's answer
	// rather than the default before it.
	loaded: boolean;
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
	// Only the browser's own step through history — Back, Forward, or the load
	// itself — says where the board should be. The board's own navigation
	// builds a route afresh and leaves the moment out; that is no ask for live.
	const navigationType = useNavigationType();

	// What this hook last put in the URL. Any other value got there by a link,
	// a reload, or Back and Forward, and the board is taken to it.
	const written = useRef<number | null | typeof UNREAD>(UNREAD);
	// Set while the board is on its way to a moment the URL asked for, holding
	// the cut it stood at when asked: the URL is left alone until the board has
	// moved, or it would be overwritten under the scrub it asked for.
	const arriving = useRef<{from: number | null} | null>(null);
	// When the needle was last let go of: the next moment written soon after is
	// a new entry.
	const settledAt = useRef(0);

	const settle = useCallback(() => {
		settledAt.current = Date.now();
	}, []);

	useEffect(() => {
		if (!loaded || inUrl === written.current) return;
		if (navigationType !== 'POP' && written.current !== UNREAD) return;

		// A page opened without a moment leaves a board another tab parked
		// where it is, and writes that moment in; only Back or Forward onto an
		// entry without one is a way back to live.
		const firstRead = written.current === UNREAD;
		written.current = inUrl;
		if (inUrl === cut || (firstRead && inUrl === null)) return;

		arriving.current = {from: cut};
		if (inUrl === null) goLive();
		else scrubTo(inUrl);
	}, [loaded, inUrl]);

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
