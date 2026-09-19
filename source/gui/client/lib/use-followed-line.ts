// Running the follow: watching the log's newest line and opening what it leads
// to. The decision itself is `followStep`; this is what drives it.
//
// On the board's side, never in the panel. The panel is drawn in two places —
// beside the board, and in a window of its own — and it was the panel that ran
// this once, so following simply stopped existing whenever the log popped out.
// The board already slices the log for both, and following is the same kind of
// answer: one place decides, and whichever panel is up reports what it needs to
// and draws what it is told.
//
// So this takes the pin as a value rather than reading a ref off a pane. A
// docked panel reports its own; a popped-out one posts it back across the
// window boundary, the same way it posts back a click.

import {useEffect, useRef, useState} from 'react';
import {LogEntry} from './event-log';
import {FollowMark, followStep, NOT_FOLLOWING} from './follow-log';
import {LogDestination} from './log-destination';

export const useFollowedLine = ({
	following,
	live,
	pinned,
	entries,
	at,
	onOpen,
}: {
	following: boolean;
	// The board is standing at the present. A checkout or a movie is somewhere
	// else and moves the board itself.
	live: boolean;
	// The panel is at its foot, so the reader is watching rather than reading
	// back through what is there.
	pinned: boolean;
	entries: readonly LogEntry[];
	// Where the reader is, so following can tell "already there" from "went
	// there once".
	at: LogDestination | null;
	onOpen: (destination: LogDestination, options: {replace: boolean}) => void;
}): {
	// The line the board is standing on, for the panel to mark. Null while
	// nothing is being followed.
	followedLine: string | null;
} => {
	const [followedLine, setFollowedLine] = useState<string | null>(null);
	const markRef = useRef<FollowMark>(NOT_FOLLOWING);

	const newestId = entries[entries.length - 1]?.id ?? null;

	// Read by the effect but deliberately not among its dependencies: both are
	// rebuilt on every render of the board, and depending on either would run
	// this on renders where no line arrived — the first of which to find the
	// pane pinned would navigate with nothing new to show.
	const sourcesRef = useRef({entries, at, onOpen});
	sourcesRef.current = {entries, at, onOpen};

	useEffect(() => {
		if (!following) {
			markRef.current = NOT_FOLLOWING;
			setFollowedLine(null);
			return;
		}

		if (!live) return;

		const sources = sourcesRef.current;

		const step = followStep({
			entries: sources.entries,
			newestId,
			mark: markRef.current,
			pinned,
			at: sources.at,
		});

		markRef.current = step.mark;

		// Set even when nothing opened: standing still on a line already open is
		// still standing on it.
		if (step.mark.line !== null) setFollowedLine(step.mark.line);

		// Replaced rather than pushed: an hour of following would otherwise leave
		// Back walking the reader through somebody else's afternoon.
		if (step.open) sources.onOpen(step.open, {replace: true});
		// `pinned` is listed so that returning to the foot resumes a following the
		// reader paused by reading back, rather than leaving it dormant until the
		// next line happens to arrive.
	}, [following, live, newestId, pinned]);

	return {followedLine};
};
