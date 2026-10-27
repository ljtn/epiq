// Following the log: which line, if any, the panel should open for itself.
// Pure, so the cases a panel can't be put into on demand are testable.

import {LogEntry} from './event-log';
import {destinationOf, LogDestination} from './log-destination';

// The last line following saw. Null until it looks: enabling opens nothing.
export type FollowMark = {line: string | null};

export const NOT_FOLLOWING: FollowMark = {line: null};

const sameDestination = (
	left: LogDestination,
	right: LogDestination,
): boolean =>
	left.kind === 'commit' || right.kind === 'commit'
		? left.kind === right.kind &&
		  left.kind === 'commit' &&
		  right.kind === 'commit' &&
		  left.sha === right.sha
		: left.issueId === right.issueId &&
		  left.tab === right.tab &&
		  (right.comment === undefined || left.comment === right.comment);

export type FollowStep =
	// Nothing to do, but the mark may have moved on.
	{open: null; mark: FollowMark} | {open: LogDestination; mark: FollowMark};

/**
 * `entries` oldest first. `pinned` is the pane's rule for whether the reader
 * is at the foot; `at` is where the reader actually is now.
 */
export const followStep = ({
	entries,
	newestId,
	mark,
	pinned,
	at,
}: {
	entries: readonly LogEntry[];
	newestId: string | null;
	mark: FollowMark;
	pinned: boolean;
	at: LogDestination | null;
}): FollowStep => {
	// The first look opens the newest line that leads anywhere at once, ignoring
	// the pin and the mark, so the reader sees following work.
	const first = mark.line === null;

	if (!first) {
		if (newestId === null || newestId === mark.line) return {open: null, mark};
		if (!pinned) return {open: null, mark};
	}

	// The newest line that leads anywhere, searched back only to the mark, so a
	// burst leading nowhere never reopens an older ticket.
	let target: LogDestination | null = null;

	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry) break;
		if (!first && entry.id === mark.line) break;

		const destination = destinationOf(entry);
		if (destination) {
			target = destination;
			break;
		}
	}

	// The line is seen either way: a burst of lines that lead nowhere must not
	// leave following waiting to be told about them again.
	if (!target) return {open: null, mark: {line: newestId}};

	// Already there: no navigation.
	if (at && sameDestination(at, target)) {
		return {open: null, mark: {line: newestId}};
	}

	return {open: target, mark: {line: newestId}};
};
