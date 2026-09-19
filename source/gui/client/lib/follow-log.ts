// Following the log: which line, if any, the panel should open for itself.
//
// A pure decision rather than a branch inside the effect that runs it, because
// every interesting case here is a case the panel cannot be put into on demand
// — a burst arriving at once, the same ticket twice, a line that leads nowhere.

import {LogEntry} from './event-log';
import {destinationOf, LogDestination} from './log-destination';

// The last line following saw. Null means it has not looked yet — enabling
// seeds this without opening anything, so switching on is not a request to go
// wherever the log happens to be standing.
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
		: left.issueId === right.issueId && left.tab === right.tab;

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
 *
 * `at` is where the reader actually is, not where following last sent them.
 * Those differ the moment the reader clicks anything themselves, and following
 * must not go quiet on the ticket the log is talking about because it once
 * opened it and the reader has since walked off.
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
	// The first look after the switch is its own rule.
	//
	// It opens the newest line that leads anywhere, straight away, rather than
	// banking the mark and waiting. A mode that announces itself by doing
	// nothing cannot be told from one that is broken: the reader presses the
	// button, the board sits still, and nothing says whether it is watching or
	// wedged. The jump is the demonstration.
	//
	// Two differences from every look after it, both deliberate:
	//
	// - the search is unbounded, because there is no mark to stop at. That is
	//   the case the bound below exists to prevent — falling back to an older
	//   line — and here it is the point: the newest thing in the window is
	//   exactly what the reader is being shown.
	// - the pin does not apply. Every other move is refused while the reader is
	//   reading back through the log, because an arrival is not their doing.
	//   Pressing the button is.
	const first = mark.line === null;

	if (!first) {
		if (newestId === null || newestId === mark.line) return {open: null, mark};
		if (!pinned) return {open: null, mark};
	}

	// The newest line that leads anywhere, searched back only as far as the
	// line already seen: a burst is one move rather than a walk through it, and
	// the board- and swimlane-level lines it passes are skipped because they
	// lead nowhere at all.
	//
	// Stopping at the mark is what keeps it honest. Unbounded, a burst that
	// leads nowhere at all — a swimlane renamed, say — would fall back to some
	// older line still in the window and open a ticket nothing had happened to.
	//
	// A reverse loop rather than a reversed copy and a map: the window can hold
	// twenty thousand entries and this runs on every arrival, where the answer
	// is almost always the last one.
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

	// Already there. A run of edits on the open ticket would otherwise re-open
	// it on every one — and this asks where the reader *is*, so it stops being
	// true the moment they click away themselves. It holds on the first look
	// too: switching on while already reading the newest thing should not be a
	// navigation to where you are.
	if (at && sameDestination(at, target)) {
		return {open: null, mark: {line: newestId}};
	}

	return {open: target, mark: {line: newestId}};
};
