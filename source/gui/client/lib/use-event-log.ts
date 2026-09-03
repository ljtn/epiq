// What the log panel shows, start to finish: which of the window's events and
// commits belong in it, where the board is standing, and the tail of that.
//
// One module rather than four blocks in the component that renders the panel.
// The answer depends on the window, the bar's own filters, the checkout and the
// playhead — enough moving parts that keeping them together is the difference
// between one rule and four that drift.

import {useMemo} from 'react';
import {BoardSelection, hiddenIdsFor} from './board-selection';
import {buildLogEntries, LogEntry, logEntriesUpTo} from './event-log';
import {
	GuiCommitEntry,
	GuiEventTimeline,
	GuiTimeTravelStatus,
} from './gui-state.model';
import {isShown, listIdentities} from './scrubber';

// Module scope, so a shut panel does not hand the memos below a new array on
// every render.
const NONE: LogEntry[] = [];

export type EventLogSources = {
	// False leaves every memo below cold: a panel nobody is looking at should
	// cost nothing, however long the window is.
	open: boolean;
	timeline: GuiEventTimeline | null;
	commits: readonly GuiCommitEntry[];
	// The bar's own narrowing — which kind, whose events, and whether the board
	// is down to one ticket.
	selection: BoardSelection;
	selectedIssueId: string | null;
	// The two series checkboxes. A series the chart is not drawing is not one
	// the log should be reciting either.
	showIssues: boolean;
	showCommits: boolean;
	// A movie is up, and where its playhead has reached — which is null until it
	// reaches its first event. The two are separate because "no event yet" is a
	// real position (before all of them) rather than the absence of a movie.
	playing: boolean;
	playheadTime: number | null;
	timeTravel: GuiTimeTravelStatus | undefined;
};

// Where the board is standing, which is the only thing the three cases differ
// by: the playhead while a movie runs, the checkout while the needle is parked,
// and the present while live.
export const momentOnScreen = (
	playing: boolean,
	playheadTime: number | null,
	timeTravel: GuiTimeTravelStatus | undefined,
): number => {
	// A movie that has not reached its first event yet stands before all of
	// them, which is not the same as standing at the present.
	if (playing) return playheadTime ?? -Infinity;

	if (timeTravel?.mode === 'scrub' && timeTravel.asOfTime !== null) {
		return timeTravel.asOfTime;
	}

	return Infinity;
};

export const useEventLog = ({
	open,
	timeline,
	commits,
	selection,
	selectedIssueId,
	showIssues,
	showCommits,
	playing,
	playheadTime,
	timeTravel,
}: EventLogSources): LogEntry[] => {
	const {view, only, ticketOnly} = selection;

	// The board is down to one ticket only while one is actually open — the box
	// can be left ticked by a link.
	const issueOnly =
		ticketOnly && selectedIssueId !== null ? selectedIssueId : null;

	// Both series in one column, filtered the way the chart above filters them
	// and in clock order, which is not the order the log stores either of them
	// in. Built when the window or the filters move, not on every render.
	const rows = useMemo(() => {
		if (!open) return NONE;

		const events = timeline?.events ?? [];
		// `isShown` is the chart's own rule, imported rather than restated: the
		// log and the picture above it must never disagree about what is in the
		// window.
		const hidden = hiddenIdsFor(listIdentities(timeline, view), only);

		return buildLogEntries(
			showIssues
				? events.filter(entry => isShown(entry, view, hidden, issueOnly))
				: [],
			showCommits ? commits : [],
		);
	}, [open, timeline, commits, view, only, issueOnly, showIssues, showCommits]);

	const moment = momentOnScreen(playing, playheadTime, timeTravel);

	// Sliced when the moment moves rather than on every render: a movie renders
	// the board on every animation frame but reaches a new event a few times a
	// second, and the panel only wants a new list for the latter.
	return useMemo(() => logEntriesUpTo(rows, moment), [rows, moment]);
};
