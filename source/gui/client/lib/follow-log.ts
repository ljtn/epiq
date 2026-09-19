// Following the log: which line, if any, the panel should open for itself.
//
// A pure decision rather than a branch inside the effect that runs it, because
// every interesting case here is a case the panel cannot be put into on demand
// — a burst arriving at once, the same ticket twice, a line that leads nowhere.

import {LogEntry} from './event-log';
import {destinationOf, LogDestination} from './log-destination';

// What following has already done: the last line it saw, and where it last
// went. `line` null means it has not looked yet — enabling seeds this without
// opening anything, so switching on is not a request to go wherever the log
// happens to be standing.
export type FollowMark = {line: string | null; went: string | null};

export const NOT_FOLLOWING: FollowMark = {line: null, went: null};

export type FollowStep =
	// Nothing to do, but the mark may have moved on.
	{open: null; mark: FollowMark} | {open: LogDestination; mark: FollowMark};

/**
 * `entries` in the order the panel draws them, oldest first.
 *
 * `pinned` is the panel's own rule for whether the reader is watching the foot
 * or reading back through what is there. Following obeys it rather than adding
 * a second one: scrolled back, the pane already refuses to pull itself down,
 * and taking the board away would be the same interruption by another route.
 */
export const followStep = ({
	entries,
	newestId,
	mark,
	pinned,
}: {
	entries: readonly LogEntry[];
	newestId: string | null;
	mark: FollowMark;
	pinned: boolean;
}): FollowStep => {
	// First look after the switch: remember where the log stands, go nowhere.
	if (mark.line === null)
		return {open: null, mark: {line: newestId, went: null}};

	if (newestId === null || newestId === mark.line) return {open: null, mark};

	if (!pinned) return {open: null, mark};

	// The newest line that leads anywhere, so a burst is one move rather than a
	// walk through it, and the board- and swimlane-level lines it passes are
	// skipped because they lead nowhere at all.
	const target = [...entries]
		.reverse()
		.map(entry => destinationOf(entry))
		.find((destination): destination is LogDestination => destination !== null);

	// The line is seen either way: a burst of lines that lead nowhere must not
	// leave following waiting to be told about them again.
	if (!target) return {open: null, mark: {line: newestId, went: mark.went}};

	// Where the reader already is. A run of comments on the open ticket would
	// otherwise re-open it on every one.
	const went = JSON.stringify(target);
	if (went === mark.went) return {open: null, mark: {line: newestId, went}};

	return {open: target, mark: {line: newestId, went}};
};
