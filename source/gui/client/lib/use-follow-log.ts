// Following the log: whether the board rides the present, and what stops it.
// Which line to open is `follow-log.ts`.

import {useEffect} from 'react';
import {useState} from 'react';

// Clicks here keep the watch: the log itself and the control. Anywhere else
// ends it.
const WATCHING_SURFACES =
	'[data-testid="event-log"], [data-testid="live-toggle"]';

export type FollowLog = {
	following: boolean;
	// Switching it on opens the log, because following without it is a control
	// that is on and inert.
	setFollowing: (next: boolean) => void;
};

export const useFollowLog = ({
	logOpen,
	live,
	onOpenLog,
}: {
	// A shut log has nothing to follow; popped out is not shut.
	logOpen: boolean;
	// At the present and connected. Otherwise following ends, as the control is
	// disabled.
	live: boolean;
	onOpenLog: () => void;
}): FollowLog => {
	// Not persisted: a board that navigates by itself on open would surprise.
	const [following, setFollowingState] = useState(false);

	// Anything that leaves nothing to follow ends the watch.
	useEffect(() => {
		if (!live || !logOpen) setFollowingState(false);
	}, [live, logOpen]);

	// On the document, since the ticket and diff panels sit outside `<main>`. On
	// click, not pointerdown, so the banner doesn't vanish mid-press.
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
