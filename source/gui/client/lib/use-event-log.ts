// What the log panel shows: the window's events and commits that belong in
// it, up to where the board is standing.

import {keptCommits, linkableIssues} from './commit-link';
import {useMemo} from 'react';
import {BoardSelection, hiddenIdsFor, narrowingFor} from './board-selection';
import {buildLogEntries, LogEntry, logEntriesUpTo} from './event-log';
import {
	GuiCommitEntry,
	GuiEventTimeline,
	GuiEventTimelineEntry,
	GuiTimeTravelStatus,
} from './gui-state.model';
import {
	identityAxisFor,
	isShown,
	keptIssueIds,
	listIdentities,
	plottedView,
} from './scrubber';

// Module scope, so a shut panel does not hand the memos below a new array on
// every render.
const NONE: LogEntry[] = [];

// Whether a line belongs to the board on screen. A null board means every
// board, as on the server.
export const onThisBoard = (
	entry: GuiEventTimelineEntry,
	boardId: string | null,
): boolean => !boardId || entry.board === null || entry.board === boardId;

// Past the server's cap a window has buckets but no events; say so, unless
// the board series is switched off.
export const eventsWentUnlisted = (
	open: boolean,
	showIssues: boolean,
	timeline: GuiEventTimeline | null,
): boolean => open && showIssues && timeline?.capped === true;

export type EventLogSources = {
	// False leaves every memo below cold: a panel nobody is looking at should
	// cost nothing, however long the window is.
	open: boolean;
	timeline: GuiEventTimeline | null;
	// The board on screen, which is the one a log line's route is built from.
	// Null before a board is known, when there is nothing to narrow to.
	boardId: string | null;
	commits: readonly GuiCommitEntry[];
	// The bar's own narrowing — which kind, whose events, and whether the board
	// is down to one ticket.
	selection: BoardSelection;
	selectedIssueId: string | null;
	// The tickets the text query keeps, and null while there is no query.
	queryIssueIds: ReadonlySet<string> | null;
	// The Code series narrowed to linked commits, and the refs that rule reads.
	linkedCommitsOnly: boolean;
	boardIssueIdByRef: ReadonlyMap<string, string>;
	issueIdByRef: ReadonlyMap<string, string>;
	// The two series checkboxes. A series the chart is not drawing is not one
	// the log should be reciting either.
	showIssues: boolean;
	showCommits: boolean;
	// A movie is up, and its playhead: null before its first event.
	playing: boolean;
	playheadTime: number | null;
	timeTravel: GuiTimeTravelStatus | undefined;
};

// Where the board is standing: playhead, parked checkout, or the present.
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

export type EventLogView = {
	entries: LogEntry[];
	// The lines shown are commits alone because events went unlisted; only while
	// the board series is on.
	eventsUnlisted: boolean;
	// The moment the lines were sliced against, handed out with them: the panel
	// snaps to its foot when this moves, and not when a line merely arrives.
	moment: number;
};

export const useEventLog = ({
	open,
	timeline,
	boardId,
	commits,
	selection,
	selectedIssueId,
	queryIssueIds,
	linkedCommitsOnly,
	boardIssueIdByRef,
	issueIdByRef,
	showIssues,
	showCommits,
	playing,
	playheadTime,
	timeTravel,
}: EventLogSources): EventLogView => {
	const {only, ticketOnly} = selection;
	const view = plottedView(only);

	// The board is down to one ticket only while one is actually open — the box
	// can be left ticked by a link.
	const issueOnly =
		ticketOnly && selectedIssueId !== null ? selectedIssueId : null;
	const keptIssues = useMemo(
		() => keptIssueIds(issueOnly, queryIssueIds),
		[issueOnly, queryIssueIds],
	);

	// Both series in clock order, filtered as the chart filters them.
	const rows = useMemo(() => {
		if (!open) return NONE;

		const events = timeline?.events ?? [];
		// `isShown` is the chart's own rule, so the two never disagree; only the
		// coloured axis hides events. Other boards' lines are dropped: their routes
		// would lead somewhere wrong.
		const axis = identityAxisFor(view);
		const hidden = hiddenIdsFor(
			listIdentities(timeline, axis),
			narrowingFor(only, axis),
		);

		return buildLogEntries(
			showIssues
				? events.filter(
						entry =>
							onThisBoard(entry, boardId) &&
							isShown(entry, view, hidden, keptIssues),
				  )
				: [],
			showCommits
				? keptCommits(
						commits,
						linkedCommitsOnly,
						issueOnly !== null,
						linkableIssues({
							everyBoard: issueIdByRef,
							thisBoard: boardIssueIdByRef,
							ticketFocus: issueOnly !== null,
						}),
						keptIssues,
				  )
				: [],
			new Set(issueIdByRef.keys()),
		);
	}, [
		open,
		timeline,
		boardId,
		commits,
		view,
		only,
		issueOnly,
		keptIssues,
		linkedCommitsOnly,
		boardIssueIdByRef,
		issueIdByRef,
		showIssues,
		showCommits,
	]);

	const moment = momentOnScreen(playing, playheadTime, timeTravel);

	// Re-sliced when the moment moves, not on every movie frame.
	const entries = useMemo(
		() => logEntriesUpTo(rows, moment, playing),
		[rows, moment, playing],
	);

	const eventsUnlisted = eventsWentUnlisted(open, showIssues, timeline);

	return useMemo(
		() => ({entries, moment, eventsUnlisted}),
		[entries, moment, eventsUnlisted],
	);
};
