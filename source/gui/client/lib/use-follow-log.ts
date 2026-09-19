// Following the log: the one question of whether the board is riding the
// present, and what stops it.
//
// A module rather than five pieces in `App`, which `HZCA9EG` is already about.
// Three callers need parts of this — the bar draws the control, the log panel
// runs the effect that opens each new line, and the board is what the reader
// reaches for when they have stopped watching — so it belongs above all three
// rather than in whichever one happened to need it first.
//
// The decision about *which* line to open is `follow-log.ts`. This is when
// following is on at all.

import {useEffect} from 'react';
import {useState} from 'react';

// The two surfaces. The log is what the reader is watching; everything else is
// the work. A click in the work says they have stopped watching — a card, a tab
// in the ticket panel, a button in the diff panel. A click in the log, or on
// the bar that holds the control itself, does not.
const WATCHING_SURFACES =
	'[data-testid="event-log"], [data-testid="time-scrubber"]';

export type FollowLog = {
	following: boolean;
	// Switching it on opens the log, because following without it is a control
	// that is on and inert.
	setFollowing: (next: boolean) => void;
};

export const useFollowLog = ({
	logOpen,
	onOpenLog,
}: {
	logOpen: boolean;
	onOpenLog: () => void;
}): FollowLog => {
	// Not persisted, unlike the panel's field boxes. Those say what a line
	// shows; this makes the board move on its own, and nobody would connect a
	// board that starts navigating on open to a switch they left on yesterday.
	const [following, setFollowingState] = useState(false);

	// On the document rather than on a container, because the panels are not
	// inside the board: the ticket panel and the diff panel are siblings of
	// `<main>`, so a handler on either one misses the other. A tab changed in
	// the ticket panel is the commonest way somebody stops watching, and it was
	// the case that got this wrong twice.
	//
	// On the click rather than the pointer going down: the banner goes when
	// following does, and a band that disappears between press and release moves
	// the board out from under the press.
	useEffect(() => {
		if (!following) return;

		const stillWatching = (target: EventTarget | null) =>
			target instanceof Element && target.closest(WATCHING_SURFACES) !== null;

		const release = (event: Event) => {
			if (stillWatching(event.target)) return;
			setFollowingState(false);
		};

		// Captured, so it counts even where a child stops the click. A drag says
		// the same as a click and never reaches one.
		document.addEventListener('click', release, true);
		document.addEventListener('dragstart', release, true);

		return () => {
			document.removeEventListener('click', release, true);
			document.removeEventListener('dragstart', release, true);
		};
	}, [following]);

	return {
		following,
		setFollowing: (next: boolean) => {
			// The log's lines are what is followed, and the window is only
			// refetched while the panel is open.
			if (next && !logOpen) onOpenLog();
			setFollowingState(next);
		},
	};
};
