// What the log panel shows, start to finish: which of the window's events and
// commits belong in it, where the board is standing, and the tail of that.
//
// One module rather than four blocks in the component that renders the panel.
// The answer depends on the window, the bar's own filters, the checkout and the
// playhead — enough moving parts that keeping them together is the difference
// between one rule and four that drift.

import {keptCommits} from './commit-link';
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

// Whether a line belongs to the board being looked at. A null board is every
// board rather than none — a contributor claim decides who the commits on all
// of them belong to — so it is kept whichever board is open. Mirrors the
// server's own narrowing, which keeps the same events for the same reason.
export const onThisBoard = (
	entry: GuiEventTimelineEntry,
	boardId: string | null,
): boolean => !boardId || entry.board === null || entry.board === boardId;

// Whether the panel owes the reader a word about the events it is not showing.
// Past the server's cap a window arrives with its buckets but no events, so a
// log of commits alone would read as a quiet stretch rather than a crowded one.
// Only the board series is missing, so a reader who has turned that series off
// is already seeing everything asked for and is told nothing.
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
	// The Code series narrowed to commits linked to a ticket, and the tickets
	// by ref that rule reads.
	linkedCommitsOnly: boolean;
	issueIdByRef: ReadonlyMap<string, string>;
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

export type EventLogView = {
	entries: LogEntry[];
	// The window holds more events than the server will list, so the lines the
	// panel is showing are its commits alone. Only while the board series is on
	// — with it off the log is commits-only because the reader asked, and
	// saying events are missing would be wrong.
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

	// Both series in one column, filtered the way the chart above filters them
	// and in clock order, which is not the order the log stores either of them
	// in. Built when the window or the filters move, not on every render.
	const rows = useMemo(() => {
		if (!open) return NONE;

		const events = timeline?.events ?? [];
		// `isShown` is the chart's own rule, imported rather than restated: the
		// log and the picture above it must never disagree about what is in the
		// window.
		// Only the axis the chart is coloured by hides events; the others narrow
		// the board under it without taking anything out of the picture above.
		//
		// The board is the one exception, and deliberately so. Under All-boards
		// the window holds other boards' events, and the chart is right to plot
		// them — that is what the toggle was turned on for. But a line in the log
		// is a thing to click, and a ticket's route is built from the board on
		// screen, so a foreign line leads somewhere wrong (`S021YSM`). The log
		// keeps what this board can act on; the picture above it keeps the lot.
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
				? keptCommits(commits, linkedCommitsOnly, issueIdByRef, keptIssues)
				: [],
		);
	}, [
		open,
		timeline,
		boardId,
		commits,
		view,
		only,
		keptIssues,
		linkedCommitsOnly,
		issueIdByRef,
		showIssues,
		showCommits,
	]);

	const moment = momentOnScreen(playing, playheadTime, timeTravel);

	// Sliced when the moment moves rather than on every render: a movie renders
	// the board on every animation frame but reaches a new event a few times a
	// second, and the panel only wants a new list for the latter.
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
