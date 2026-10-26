// The scrubber's logic: what the axis is, what is hovered, what a drag means.
// It computes and hands the result to ScrubberLayout, which owns the markup.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {commitAuthorLabel} from '../lib/commit-author';
import {actorDisplay} from '../lib/agent-identity';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {maxOf} from '../../../lib/utils/minmax.js';
import {
	GuiCommitEntry,
	GuiEventIdentity,
	GuiEventTimeline,
	GuiTimeTravelStatus,
	GuiUser,
} from '../lib/gui-state.model';
import {
	AxisState,
	axisState,
	BoardSelection,
	hiddenIdsFor,
	isNarrowed,
	isolateOnly,
	narrowingFor,
	toggleAxis,
	toggleOnly,
	withNarrowing,
	withSelectedIdentities,
} from '../lib/board-selection';
import {
	bucketCommitStats,
	logShare,
	bucketIssueCounts,
	buildAxis,
	isScrubbable,
	buildFlowChart,
	FlowChart,
	FlowLane,
	flowStrandOf,
	boardViewColor,
	buildEventDots,
	keptIssueIds,
	chooseGrainUnit,
	chooseSegmentUnit,
	clamp,
	DOT_EXIT_TOTAL_MS,
	dotDetail,
	EventDot,
	FILTER_AXES,
	FilterAxis,
	identityAxisFor,
	isFilterAxis,
	listIdentitiesByAxis,
	narrowedIds,
	plottedView,
	soleVisibleIdentity,
	createWheelPager,
	formatInterval,
	formatPeriodLabel,
	getPeriodRange,
	hourFractionForTime,
	isHorizontalWheel,
	LayoutMode,
	MIN_RANGE_DRAG_PX,
	MIN_ZOOM_SPAN_MS,
	populatedRange,
	Scope,
	segmentAt,
	segmentBoundaries,
	useExitTransition,
	isPeriodWindow,
	useNarrowBar,
	usePrefersReducedMotion,
	windowNamesIssues,
} from '../lib/scrubber';
import {usePersistedChoice, usePersistedFlag} from '../lib/use-persisted-flag';
import {canPlayTimeline} from '../lib/theatre';
import {keptCommits, linkableIssues} from '../lib/commit-link';
import {withoutHiddenRepos} from '../lib/commit-repo-filter';
import {HintContent, ScrubberLayout} from './ScrubberLayout';
import {ScatterLayer, ScatterPoint} from './ScatterCanvas';
import {FlowHover} from './FlowCanvas';
import {GUI_THEME} from '../lib/gui-theme';

const SCRUB_THROTTLE_MS = 120;

// Module scope, so a view that colours by nothing hands the chart the same
// empty legend every render rather than a fresh one to re-memoize against.
const EMPTY_IDENTITIES: GuiEventIdentity[] = [];
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();
// The flow chart outside the flow layout: nothing to draw, and nothing to
// rebuild on every window while the other layouts are up.
const EMPTY_FLOW: FlowChart = {strands: [], paths: []};

// Still needed by the Volume hover, which reads a bucket's count rather than a
// dot. The scatter's own hint comes from dotDetail.
const boardEventRow = (count: number) =>
	`${count} board event${count === 1 ? '' : 's'}`;

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';
const ALL_BOARDS_STORAGE_KEY = 'epiq.timeScrubber.allBoards';
const CATEGORIES_EXPANDED_STORAGE_KEY = 'epiq.timeScrubber.categoriesExpanded';
// Which axis's list is open in the series popover, not whether one is: with an
// axis per row only one is shown at a time, so the answer is a name.
const EXPANDED_AXIS_STORAGE_KEY = 'epiq.timeScrubber.expandedAxis';
// Whether Code bars count commits or lines; stored apart from the narrowing.
const LINES_MEASURE_STORAGE_KEY = 'epiq.timeScrubber.linesMeasure';

export const TimeScrubber = ({
	timeline,
	commits,
	historyId,
	timeTravel,
	onScrub,
	onNeedleDragging,
	onNeedleSettle,
	onReturnToLive,
	onRequestHistory,
	boardId,
	connected,
	socketEpoch,
	highlightEventId,
	onInspectCommit,
	onOpenIssue,
	selection,
	onChangeSelection,
	selectedIssue,
	textFilter,
	onChangeTextFilter,
	queryIssueIds,
	knownIdentities,
	refreshOn,
	onPlayTheatre,
	theatreOpen,
	logOpen,
	onChangeLogOpen,
	following,
	onChangeFollowing,
	showIssues,
	onChangeShowIssues,
	showCommits,
	onChangeShowCommits,
	linkedCommitsOnly,
	onChangeLinkedCommitsOnly,
	commitRepos,
	hiddenCommitRepos,
	onToggleCommitRepo,
	issueIdByRef,
	boardIssueIdByRef,
	lanes,
	laneTitles,
	issueSummaryById,
}: {
	timeline: GuiEventTimeline | null;
	commits: GuiCommitEntry[];
	// Identifies the window `timeline` and `commits` came from.
	historyId: number;
	timeTravel: GuiTimeTravelStatus;
	onScrub: (targetTime: number) => void;
	// A needle held and dragged, and a needle let go of: a drag scrubs every
	// step, and only where it is let go is a place to come back to.
	onNeedleDragging: (dragging: boolean) => void;
	onNeedleSettle: () => void;
	onReturnToLive: () => void;
	// Undefined bounds ask for all time. Both series in one call, since they share
	// an axis. Returns the reply's id.
	onRequestHistory: (
		start?: number,
		end?: number,
		allBoards?: boolean,
	) => number;
	boardId: string | null;
	connected: boolean;
	// Identifies the socket in hand. A replaced socket takes its outstanding
	// history replies with it, so the request has to go out again on the new one.
	socketEpoch: number;
	// The event a hovered Log row points at. Every other dot dims around it.
	highlightEventId: string | null;
	onInspectCommit: (sha: string) => void;
	// A click on a flow line opens its ticket.
	onOpenIssue: (issueId: string) => void;
	// Owned above, in the URL: it also decides which tickets the board shows.
	selection: BoardSelection;
	onChangeSelection: (patch: Partial<BoardSelection>) => void;
	// The open ticket, for the ticket narrowing: its id filters events, its
	// creation starts the window. Null greys the checkbox out.
	selectedIssue: {id: string; createdAt: number} | null;
	// The board's text query. Owned above with the rest of the board's
	// narrowings; it sits on this bar because every narrowing does.
	textFilter: string;
	onChangeTextFilter: (next: string) => void;
	// The tickets that query keeps, and null while there is none: the chart
	// plots the tickets the columns show.
	queryIssueIds: ReadonlySet<string> | null;
	// The Code series narrowed to ticket-linked commits, and the ref maps that
	// rule reads: the board's own, or the repository's across every board.
	linkedCommitsOnly: boolean;
	onChangeLinkedCommitsOnly: (next: boolean) => void;
	// Which repos the Code series plots; hidden ones drop out without rescaling.
	commitRepos: readonly string[];
	hiddenCommitRepos: ReadonlySet<string>;
	onToggleCommitRepo: (repo: string) => void;
	issueIdByRef: ReadonlyMap<string, string>;
	boardIssueIdByRef: ReadonlyMap<string, string>;
	// What the flow layout draws its strands from: this board's lanes in column
	// order, and every lane's title for one the window names off this board.
	lanes: readonly FlowLane[];
	laneTitles: ReadonlyMap<string, string>;
	// Every ticket by id, for naming and colouring its line: the line takes its
	// first assignee's colour, so a board's lines say whose tickets they are.
	issueSummaryById: ReadonlyMap<
		string,
		{ref: string; title: string; assignee: GuiUser | null}
	>;
	// Every tag and person the board knows, per axis, for naming a selected
	// identity the window itself holds no event for.
	knownIdentities: Record<FilterAxis, GuiEventIdentity[]>;
	// A change refetches the window: it decides which tickets the board shows and
	// feeds the log, so it must include anything filed since.
	refreshOn: unknown;
	// The live half of the transport. Owned by the board, which also turns it
	// off when the reader reaches for it.
	following: boolean;
	onChangeFollowing: (next: boolean) => void;
	// Opens the history player over this window.
	onPlayTheatre: () => void;
	// The event log panel. Owned above because the panel is in the board's row,
	// not in this bar.
	logOpen: boolean;
	onChangeLogOpen: (next: boolean) => void;
	// The two series. Owned above because the log is drawn from them too, and it
	// is not this component's to draw.
	showIssues: boolean;
	onChangeShowIssues: (next: boolean) => void;
	showCommits: boolean;
	onChangeShowCommits: (next: boolean) => void;
	// The player is up. It owns the board's position for as long as it is, so
	// the whole bar stands down rather than competing for the same thing.
	theatreOpen: boolean;
}) => {
	const {
		scope,
		offset,
		zoom,
		layout: layoutMode,
		only,
		windowOnly,
		ticketOnly,
	} = selection;
	// Read off the filter rather than picked beside it: one axis on and the
	// chart is that axis, none or several and it draws every kind.
	const boardView = plottedView(only);
	const animate = !usePrefersReducedMotion();
	const narrow = useNarrowBar();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);
	// The moment last asked for, so a repeat of it is not asked again.
	const lastTargetRef = useRef<number | null>(null);

	const [dragFraction, setDragFraction] = useState<number | null>(null);
	// Where a range drag started and where it has reached, as track fractions.
	const [rangeDrag, setRangeDrag] = useState<{
		from: number;
		to: number;
	} | null>(null);
	// The same, live: pointer moves outrun React commits, so release reads these.
	const dragFractionRef = useRef<number | null>(null);
	const rangeDragRef = useRef<{from: number; to: number} | null>(null);
	// Set by the needle's own press, which fires before the track's: it says
	// this drag moves the needle rather than dragging out a range.
	const grabbedNeedleRef = useRef(false);
	// The commit a scatter press landed on: a click opens its diff, a drag is a
	// range. Cleared after every gesture.
	const pressedCommitRef = useRef<string | null>(null);
	// And from the flow chart, naming the ticket whose line a press landed on:
	// a click on a line opens the ticket.
	const pressedIssueRef = useRef<string | null>(null);

	const [collapsed, setCollapsed] = usePersistedFlag(
		COLLAPSED_STORAGE_KEY,
		false,
	);
	const [categoriesExpanded, setCategoriesExpanded] = usePersistedFlag(
		CATEGORIES_EXPANDED_STORAGE_KEY,
		false,
	);
	// Counting commits is the series' own question and stays the opening one;
	// measuring the lines they moved is the other one, asked for.
	const [linesMeasure, setLinesMeasure] = usePersistedFlag(
		LINES_MEASURE_STORAGE_KEY,
		false,
	);
	const [expandedAxis, setExpandedAxis] = usePersistedChoice<FilterAxis>(
		EXPANDED_AXIS_STORAGE_KEY,
		isFilterAxis,
	);
	// Unlike the series toggles this changes what is fetched, not just what is
	// drawn.
	const [allBoards, setAllBoards] = usePersistedFlag(
		ALL_BOARDS_STORAGE_KEY,
		false,
	);

	// Only the scatter animates out; bar charts untick at once.
	const exitMs = layoutMode === 'real' && animate ? DOT_EXIT_TOTAL_MS : 0;
	const issueScatter = useExitTransition(showIssues, exitMs);
	const commitScatter = useExitTransition(showCommits, exitMs);

	// The moment a hovered scatter point stands for, kept apart from the bucket
	// hover because "Events" mode plots the server's own sparse buckets.
	const [hoveredEvent, setHoveredEvent] = useState<{
		label: string;
		// The action for a per-event dot, a count for a bucketed one.
		detail: string;
		t: number;
		fraction: number;
	} | null>(null);
	// Pointer position regardless of whether a plotted point sits under it, so
	// the segment highlight works over empty stretches.
	const [pointerFraction, setPointerFraction] = useState<number | null>(null);
	const [hoveredCommit, setHoveredCommit] = useState<{
		commit: GuiCommitEntry;
		fraction: number;
	} | null>(null);
	// The ticket line under the pointer in the flow layout, and where along it.
	const [hoveredFlow, setHoveredFlow] = useState<FlowHover | null>(null);
	// Resolved arithmetically from the pointer's x rather than by per-bucket hit
	// targets: at wide spans a bucket is only ~2px across.
	const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
		null,
	);
	const [hoveredCommitBucketIndex, setHoveredCommitBucketIndex] = useState<
		number | null
	>(null);

	// Only with a ticket open; a link can leave the box ticked.
	const ticketFocus = ticketOnly && selectedIssue !== null;

	// The ticket's lifetime overrides a dragged window, derived so unticking restores it.
	const ticketRange = ticketFocus
		? {start: selectedIssue.createdAt, end: Date.now()}
		: null;

	// The events this narrowing keeps. Null leaves every ticket's events in.
	const issueOnly = ticketFocus ? selectedIssue.id : null;
	const keptIssues = useMemo(
		() => keptIssueIds(issueOnly, queryIssueIds),
		[issueOnly, queryIssueIds],
	);

	// The ticket the window is cut from, or null; only then does switching tickets
	// refetch.
	const ticketWindowKey = ticketFocus
		? `${selectedIssue.id}:${selectedIssue.createdAt}`
		: null;

	// A dragged-out window stands in for the rolling one, and is the only kind
	// with fixed bounds — every other is anchored to now.
	const periodRange = ticketRange ?? zoom ?? getPeriodRange(scope, offset);

	// periodRange is rebuilt each render, so the zoom's bounds and the ticket key
	// stand in for it in the deps.
	useEffect(() => {
		if (!connected) return;

		pendingRequestId.current = onRequestHistory(
			periodRange?.start,
			periodRange?.end,
			allBoards,
		);
	}, [
		scope,
		offset,
		zoom?.start,
		zoom?.end,
		ticketWindowKey,
		boardId,
		allBoards,
		connected,
		socketEpoch,
		refreshOn,
	]);

	const changeLayoutMode = (next: LayoutMode) =>
		onChangeSelection({layout: next});

	// Naming a scope leaves a zoom, even the scope already held.
	const changeScope = (nextScope: Scope) => {
		armEntrance();
		onChangeSelection({scope: nextScope});
	};

	// Zoomed, the pager slides by the window's own width.
	const changeOffset = (nextOffset: number) => {
		armEntrance();

		if (!zoom) {
			onChangeSelection({offset: nextOffset});
			return;
		}

		const span = zoom.end - zoom.start;
		const shift = (nextOffset - offset) * span;
		const end = Math.min(Date.now(), zoom.end - shift);

		onChangeSelection({zoom: {start: end - span, end}});
	};

	// Zooming in on the last few minutes is a legitimate ask; zooming past the
	// present is not, so a window already at it has nowhere later to go.
	const atLatest = zoom ? zoom.end >= Date.now() : offset === 0;

	// Paging (end arrows, horizontal wheel) needs periods, no ticket narrowing,
	// and a socket. The label names a window no scope button does.
	const pageable =
		connected && !ticketFocus && (scope !== 'all' || zoom !== null);
	const paging = {
		earlier: pageable,
		later: pageable && !atLatest,
		label:
			ticketFocus || zoom !== null || (scope !== 'all' && offset !== 0)
				? formatPeriodLabel(
						scope,
						offset,
						periodRange,
						zoom !== null || ticketFocus,
				  )
				: null,
	};

	// Native wheel listener: React's is passive, and an unprevented swipe navigates
	// back. One page per gesture (lib/scrubber/paging).
	const pageRef = useRef<HTMLDivElement | null>(null);
	const changeOffsetRef = useRef(changeOffset);
	changeOffsetRef.current = changeOffset;
	const pagingRef = useRef(paging);
	pagingRef.current = paging;
	const offsetRef = useRef(offset);
	offsetRef.current = offset;

	useEffect(() => {
		const track = pageRef.current;
		if (!track) return;

		const pager = createWheelPager();

		const onWheel = (event: WheelEvent) => {
			if (!isHorizontalWheel(event.deltaX, event.deltaY)) return;

			event.preventDefault();

			const turn = pager.feed(event.deltaX, event.deltaY, event.timeStamp);
			const {earlier, later} = pagingRef.current;

			if (turn === -1 && earlier)
				changeOffsetRef.current(offsetRef.current + 1);
			else if (turn === 1 && later)
				changeOffsetRef.current(offsetRef.current - 1);
		};

		track.addEventListener('wheel', onWheel, {passive: false});

		return () => track.removeEventListener('wheel', onWheel);
		// Re-attached when the charts mount: collapsing the bar unmounts them.
	}, [collapsed]);

	// The scope stays as it was: nothing reads it while zoomed.
	const zoomToRange = (from: number, to: number) => {
		const start = Math.min(from, to);
		const span = Math.max(MIN_ZOOM_SPAN_MS, Math.abs(to - from));

		armEntrance();
		onChangeSelection({zoom: {start, end: start + span}});
	};

	// No armEntrance on any of these: the window is unchanged, so they filter
	// what is already in hand rather than asking for a new one.
	const toggleAxisOn = (axis: FilterAxis, on: boolean) =>
		onChangeSelection({only: toggleAxis(only, axis, on)});

	// Toggles, so isolating again restores the rest; each axis is independent.
	const isolateIdentity = (axis: FilterAxis, id: string) =>
		onChangeSelection({
			only: withNarrowing(
				only,
				axis,
				isolateOnly(narrowedIds(narrowingFor(only, axis)), id) ?? 'all',
			),
		});

	const toggleIdentity = (axis: FilterAxis, id: string, next: boolean) =>
		onChangeSelection({
			only: withNarrowing(
				only,
				axis,
				toggleOnly(narrowingFor(only, axis), identitiesByAxis[axis], id, next),
			),
		});

	const changeAllBoards = (next: boolean) => {
		armEntrance();
		setAllBoards(next);
	};

	// Narrows the window in hand with no round trip. Only the plotted axis
	// counts, since the others don't change a dot.
	const filterKey = useMemo(() => {
		const plotted = narrowedIds(narrowingFor(only, identityAxisFor(boardView)));

		return JSON.stringify([
			boardView,
			plotted === null ? null : [...plotted].sort(),
		]);
	}, [boardView, only]);

	const entrance = useRef(0);
	const armed = useRef(true);

	const armEntrance = () => {
		armed.current = true;
	};

	// Only the reply to the window this chart asked for, so a stale reply can't win.
	const shownRef = useRef({timeline, commits});
	const pendingRequestId = useRef<number | null>(null);

	// Held while the pointer is down: a new window mid-drag would move the ground
	// under the pointer. Taken up on release.
	const gestureInFlight =
		dragFractionRef.current !== null || rangeDragRef.current !== null;

	if (
		!gestureInFlight &&
		pendingRequestId.current !== null &&
		historyId === pendingRequestId.current
	) {
		pendingRequestId.current = null;
		shownRef.current = {timeline, commits};

		if (armed.current) {
			armed.current = false;
			entrance.current += 1;
		}
	}

	const shown = shownRef.current;

	// Memoized because hovering the track re-renders on every mouse move, and a
	// window's worth of per-event dots is thousands of objects to rebuild.
	const axis = useMemo(() => buildAxis(shown.timeline, shown.commits), [shown]);

	// Only a window the server returned events for can be split at all.
	const categoriesFiltered = (timeline?.events.length ?? 0) > 0;

	// Every axis's legend, not just the plotted one's: each is a filter of its
	// own now, and all four are on offer in the popover at once.
	const identitiesByAxis = useMemo(() => {
		const listed = listIdentitiesByAxis(shown.timeline);
		const lists = {} as Record<FilterAxis, GuiEventIdentity[]>;

		for (const axis of FILTER_AXES) {
			lists[axis] = withSelectedIdentities(
				listed[axis],
				narrowedIds(narrowingFor(only, axis)),
				knownIdentities[axis],
			);
		}

		return lists;
	}, [shown, only, knownIdentities]);

	// What each top-level row says: off, on with everything, or the dash for on
	// with some of it.
	const axisStates = useMemo(() => {
		const states = {} as Record<FilterAxis, AxisState>;
		for (const axis of FILTER_AXES) states[axis] = axisState(only, axis);

		return states;
	}, [only]);

	const hiddenIdsByAxis = useMemo(() => {
		const hidden = {} as Record<FilterAxis, ReadonlySet<string>>;

		for (const axis of FILTER_AXES) {
			hidden[axis] = hiddenIdsFor(
				identitiesByAxis[axis],
				narrowingFor(only, axis),
			);
		}

		return hidden;
	}, [identitiesByAxis, only]);

	// What the chart itself is coloured by, which is still one axis at a time.
	const viewAxis = identityAxisFor(boardView);
	const identities =
		viewAxis === null ? EMPTY_IDENTITIES : identitiesByAxis[viewAxis];
	const hiddenIdentityIds =
		viewAxis === null ? EMPTY_HIDDEN : hiddenIdsByAxis[viewAxis];

	// Down to one identity, the bars take its colour, as the scatter does.
	const soleIdentity = useMemo(
		() => soleVisibleIdentity(identities, hiddenIdentityIds),
		[identities, hiddenIdentityIds],
	);

	// Memoized with the rest of the derived chart: hovering the track re-renders
	// on every mouse move, and these walk every event and every commit.
	const issueCounts = useMemo(
		() =>
			bucketIssueCounts(
				axis,
				shown.timeline,
				boardView,
				hiddenIdentityIds,
				keptIssues,
			),
		[axis, shown, boardView, hiddenIdentityIds, keptIssues],
	);
	// The board's own, the way the window itself is asked for, so `Linked` reads
	// the same here as in the log below. `linkableIssues` owns the exceptions.
	const linkedTo = linkableIssues({
		everyBoard: issueIdByRef,
		thisBoard: boardIssueIdByRef,
		ticketFocus,
		everyBoardPlotted: allBoards,
	});

	// Narrowed where commits are drawn and not where the axis is built, as the
	// ticket narrowing of events is: toggling it must not rescale the window.
	const drawnCommits = useMemo(
		() =>
			withoutHiddenRepos(
				keptCommits(
					shown.commits,
					linkedCommitsOnly,
					ticketFocus,
					linkedTo,
					keptIssues,
				),
				hiddenCommitRepos,
			),
		[
			shown.commits,
			linkedCommitsOnly,
			ticketFocus,
			linkedTo,
			keptIssues,
			hiddenCommitRepos,
		],
	);
	const commitStats = useMemo(
		() => bucketCommitStats(axis, drawnCommits),
		[axis, drawnCommits],
	);
	const liveEventDots = useMemo(
		() =>
			buildEventDots(shown.timeline, boardView, hiddenIdentityIds, keptIssues),
		[shown, boardView, hiddenIdentityIds, keptIssues],
	);

	// Each ticket's line colour: its first assignee's, where it has one.
	const issueColors = useMemo(() => {
		const colors = new Map<string, string>();

		for (const [id, summary] of issueSummaryById) {
			if (summary.assignee) colors.set(id, summary.assignee.color);
		}

		return colors;
	}, [issueSummaryById]);

	// Built only while shown: it walks every event in the window.
	const flowChart = useMemo(
		() =>
			layoutMode === 'flow'
				? buildFlowChart(
						showIssues ? shown.timeline : null,
						lanes,
						laneTitles,
						boardView,
						hiddenIdentityIds,
						keptIssues,
						issueColors,
				  )
				: EMPTY_FLOW,
		[
			layoutMode,
			showIssues,
			shown,
			lanes,
			laneTitles,
			boardView,
			hiddenIdentityIds,
			keptIssues,
			issueColors,
		],
	);

	// The hovered line; else the line a hovered log row's event sits on; else
	// the open ticket's, so opening one mutes every other line around it.
	const flowFocusIssue = useMemo(() => {
		if (hoveredFlow) return hoveredFlow.path.issue;

		if (highlightEventId !== null) {
			const lit = flowChart.paths.find(path =>
				path.vertices.some(vertex => vertex.eventId === highlightEventId),
			);
			if (lit) return lit.issue;
		}

		return selectedIssue?.id ?? null;
	}, [hoveredFlow, highlightEventId, flowChart, selectedIssue]);

	const dragging = dragFraction !== null || rangeDrag !== null;

	const needleDragging = dragFraction !== null;
	useEffect(() => {
		onNeedleDragging(needleDragging);
		// A scrubber gone mid-drag holds nothing any more.
		return () => onNeedleDragging(false);
	}, [needleDragging]);

	// Both series as one list for the canvas, in the order they should stack:
	// commits first, board events over them, as the old zIndex did.
	const commitPoints = useMemo(
		(): ScatterPoint[] =>
			drawnCommits.map(commit => ({
				key: commit.sha,
				id: null,
				t: commit.time,
				fraction: axis.fractionForTime(commit.time),
				hourFraction: hourFractionForTime(commit.time),
				radius: 2,
				color: GUI_THEME.green,
				opacity: 0.55,
				// The hint labels the moment itself, so this is the rest of it.
				title: `${commit.subject} — ${
					actorDisplay(commitAuthorLabel(commit)).label
				} (${commit.linesChanged.toLocaleString()} lines)`,
				commitSha: commit.sha,
			})),
		[drawnCommits, axis],
	);

	const issuePoints = useMemo(
		(): ScatterPoint[] =>
			liveEventDots.map(dot => ({
				key: dot.key,
				id: dot.id,
				t: dot.t,
				fraction: axis.fractionForTime(dot.t),
				hourFraction: hourFractionForTime(dot.t),
				radius: dot.size / 2,
				color: dot.color,
				opacity: dot.opacity,
				title: dotDetail(dot),
				commitSha: null,
			})),
		[liveEventDots, axis],
	);

	// A max per series: one shared max flattens the finer ones.
	const issueBars = useMemo(() => {
		const max = maxOf(issueCounts, 1);

		return issueCounts.flatMap((count, index) =>
			count > 0 ? [{index, intensity: count / max}] : [],
		);
	}, [issueCounts]);

	const commitBars = useMemo(() => {
		const max = maxOf(
			Array.from(commitStats.values(), stats => stats.count),
			1,
		);

		return Array.from(commitStats, ([index, stats]) => ({
			index,
			intensity: stats.count / max,
		}));
	}, [commitStats]);

	// One scale for both halves so windows compare; stacked, the churn sets height.
	const lineBars = useMemo(() => {
		const max = maxOf(
			Array.from(
				commitStats.values(),
				stats => stats.insertions + stats.deletions,
			),
			1,
		);

		// Removals first, so they sit on the baseline.
		return Array.from(commitStats, ([index, stats]) => {
			const total = stats.insertions + stats.deletions;
			const height = logShare(total, max);

			return {
				index,
				top: total === 0 ? 0 : (height * stats.deletions) / total,
				bottom: total === 0 ? 0 : (height * stats.insertions) / total,
			};
		}).filter(bar => bar.top + bar.bottom > 0);
	}, [commitStats]);

	const lineBarRange = useMemo(
		() =>
			populatedRange(lineBars.map(bar => ({index: bar.index, intensity: 1}))),
		[lineBars],
	);

	const issueBarRange = useMemo(() => populatedRange(issueBars), [issueBars]);
	const commitBarRange = useMemo(
		() => populatedRange(commitBars),
		[commitBars],
	);

	const armedBoardId = useRef(boardId);

	useEffect(() => {
		if (boardId === null || boardId === armedBoardId.current) return;

		armedBoardId.current = boardId;
		armEntrance();
	}, [boardId]);

	const windowKey = `${layoutMode}-${entrance.current}-${filterKey}`;

	const scatterLayers = useMemo(
		(): ScatterLayer[] => [
			...(commitScatter.mounted
				? [
						{
							id: 'commits',
							points: commitPoints,
							generation: windowKey,
							leaving: commitScatter.leaving,
						},
				  ]
				: []),
			...(issueScatter.mounted
				? [
						{
							id: 'issues',
							points: issuePoints,
							generation: windowKey,
							leaving: issueScatter.leaving,
						},
				  ]
				: []),
		],
		[commitPoints, issuePoints, commitScatter, issueScatter, windowKey],
	);

	// Null when the needle's moment is outside the window (fractionForTime would
	// clamp it to an edge). Live, read off the selection: the fetch lags the clock.
	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? timeTravel.asOfTime >= axis.earliest &&
			  timeTravel.asOfTime <= axis.latest
				? axis.fractionForTime(timeTravel.asOfTime)
				: null
			: atLatest
			? 1
			: null;

	/**
	 * Where the unapplied stretch starts, as a fraction: 0 if the checkout is
	 * before the window, the needle if inside, null if after.
	 */
	const unappliedFrom =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? timeTravel.asOfTime < axis.earliest
				? 0
				: timeTravel.asOfTime > axis.latest
				? null
				: axis.fractionForTime(timeTravel.asOfTime)
			: null;

	const fractionFromClientX = (clientX: number) => {
		const track = trackRef.current;
		if (!track) return 0;

		const rect = track.getBoundingClientRect();
		return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
	};

	const dispatchScrub = (fraction: number, force: boolean) => {
		// Scrubbing is a request to the server like any other, so it stands down
		// with the rest of the controls when there is nothing to ask.
		if (!connected) return;

		// The player drives the position; a drag begun earlier still ends here.
		if (theatreOpen) return;

		// Nothing to scrub until a window is drawn: a degenerate axis reads as now.
		if (!isScrubbable(axis)) return;

		const target = axis.fractionToTime(fraction);

		// A click dispatches on both press and release; answering the second
		// means checking out a moment the board is already at.
		if (target === lastTargetRef.current) return;

		const now = Date.now();
		if (!force && now - lastDispatchRef.current < SCRUB_THROTTLE_MS) return;

		lastDispatchRef.current = now;
		lastTargetRef.current = target;
		onScrub(target);
	};

	useEffect(() => {
		if (timeTravel.mode !== 'scrub') lastTargetRef.current = null;
	}, [timeTravel.mode]);

	const endDrag = () => {
		grabbedNeedleRef.current = false;

		const pressedCommit = pressedCommitRef.current;
		pressedCommitRef.current = null;
		const pressedIssue = pressedIssueRef.current;
		pressedIssueRef.current = null;

		// Clears the whole gesture first: a stray ref would hold the window back for good.
		const draggedTo = dragFractionRef.current;
		const range = rangeDragRef.current;

		dragFractionRef.current = null;
		rangeDragRef.current = null;

		if (draggedTo !== null) {
			onNeedleSettle();
			dispatchScrub(draggedTo, true);
			setDragFraction(null);
			setRangeDrag(null);
			return;
		}

		if (range === null) return;

		const {from, to} = range;
		setRangeDrag(null);

		const trackWidth = trackRef.current?.clientWidth ?? 0;

		// Pressed and released on one spot: a click. Only a drag wide enough to
		// have been aimed is read as a range.
		if (Math.abs(to - from) * trackWidth < MIN_RANGE_DRAG_PX) {
			// A press that began on a dot opens its diff.
			if (pressedCommit !== null) {
				onInspectCommit(pressedCommit);
				return;
			}

			if (pressedIssue !== null) {
				onOpenIssue(pressedIssue);
				return;
			}

			onNeedleSettle();
			dispatchScrub(from, true);
			return;
		}

		zoomToRange(axis.fractionToTime(from), axis.fractionToTime(to));
	};

	// Measures `event.currentTarget`, not trackRef, so one handler serves both
	// the issue track and the mirrored commit box.
	const fractionFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();

		return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
	};

	const bucketIndexFromEvent = (event: React.MouseEvent<HTMLDivElement>) =>
		clamp(
			Math.floor(fractionFromEvent(event) * axis.bucketCount),
			0,
			axis.bucketCount - 1,
		);

	// A scope change can leave behind a hover index from the previous, longer
	// axis, so every read of one is bounds-checked.
	const bucketTimeAt = (index: number | null) =>
		index !== null && index < axis.bucketCount
			? axis.bucketTimeAt(index)
			: undefined;

	const centreFraction = (index: number) => (index + 0.5) / axis.bucketCount;

	// One handler for both series now that they share a canvas: which one a
	// point belongs to is read off the point, not off which layer sent it.
	const onScatterPointEnter = useCallback(
		(point: ScatterPoint) => {
			if (point.commitSha) {
				const commit = drawnCommits.find(c => c.sha === point.commitSha);
				if (commit) {
					setHoveredCommit({commit, fraction: point.fraction});
					setHoveredEvent(null);
				}

				return;
			}

			setHoveredCommit(null);
			setHoveredEvent({
				label: formatDateTime(new Date(point.t)),
				detail: point.title,
				t: point.t,
				fraction: point.fraction,
			});
		},
		[drawnCommits],
	);

	const onScatterPointLeave = useCallback(() => {
		setHoveredEvent(null);
		setHoveredCommit(null);
	}, []);

	const onFlowPathEnter = useCallback((hover: FlowHover) => {
		setHoveredFlow(hover);
	}, []);

	const onFlowPathLeave = useCallback(() => {
		setHoveredFlow(null);
	}, []);

	// What the hovered line says: the ticket, and the lane it is in at the
	// pointer's moment.
	const flowHint: HintContent | null = useMemo(() => {
		if (layoutMode !== 'flow' || hoveredFlow === null) return null;

		const {path, t, fraction} = hoveredFlow;
		const summary = issueSummaryById.get(path.issue);
		const strand = flowStrandOf(path, t);
		const strandTitle =
			strand === null ? null : flowChart.strands[strand]?.title ?? null;

		return {
			label: formatDateTime(new Date(t)),
			rows: [
				summary ? `${summary.ref} ${summary.title}` : path.issue,
				...(strandTitle === null ? [] : [`In ${strandTitle}`]),
				...(summary?.assignee ? [`Assigned to ${summary.assignee.name}`] : []),
			],
			fraction,
		};
	}, [layoutMode, hoveredFlow, issueSummaryById, flowChart]);

	const hoveredBucketTime = bucketTimeAt(hoveredBucketIndex);
	const hoveredBucketCount =
		hoveredBucketIndex !== null ? issueCounts[hoveredBucketIndex] : undefined;
	// Nothing to say for an undrawn series, though its hit strip still hovers.
	const boardHint: HintContent | null =
		layoutMode === 'flow'
			? flowHint
			: layoutMode === 'even'
			? showIssues &&
			  hoveredBucketTime !== undefined &&
			  hoveredBucketCount !== undefined
				? {
						label: formatInterval(
							hoveredBucketTime,
							hoveredBucketTime + axis.bucketMs,
						),
						rows: [boardEventRow(hoveredBucketCount)],
						fraction: centreFraction(hoveredBucketIndex!),
						empty: hoveredBucketCount === 0,
				  }
				: null
			: hoveredEvent
			? {
					label: hoveredEvent.label,
					rows: [hoveredEvent.detail],
					fraction: hoveredEvent.fraction,
			  }
			: null;

	const hoveredCommitStats =
		hoveredCommitBucketIndex !== null
			? commitStats.get(hoveredCommitBucketIndex)
			: undefined;
	const hoveredCommitBucketTime = bucketTimeAt(hoveredCommitBucketIndex);
	const commitHint: HintContent | null =
		layoutMode === 'flow'
			? null
			: layoutMode === 'even'
			? hoveredCommitStats && hoveredCommitBucketTime !== undefined
				? {
						label: formatInterval(
							hoveredCommitBucketTime,
							hoveredCommitBucketTime + axis.bucketMs,
						),
						rows: [
							`${hoveredCommitStats.count} commit${
								hoveredCommitStats.count === 1 ? '' : 's'
							}`,
							// One figure for commits, two for lines.
							linesMeasure
								? `+${hoveredCommitStats.insertions.toLocaleString()} −${hoveredCommitStats.deletions.toLocaleString()}`
								: `${hoveredCommitStats.linesChanged.toLocaleString()} lines changed`,
						],
						fraction: centreFraction(hoveredCommitBucketIndex!),
				  }
				: null
			: hoveredCommit
			? {
					label: formatDateTime(new Date(hoveredCommit.commit.time)),
					rows: [
						hoveredCommit.commit.subject,
						`${
							actorDisplay(commitAuthorLabel(hoveredCommit.commit)).label
						} • ${hoveredCommit.commit.linesChanged.toLocaleString()} lines`,
					],
					fraction: hoveredCommit.fraction,
			  }
			: null;

	// One segment for both tracks, so the halves read as one time grid.
	const hoveredSegmentTime =
		(layoutMode === 'even'
			? hoveredBucketTime ?? bucketTimeAt(hoveredCommitBucketIndex)
			: // A hovered point wins over the raw pointer, so the highlight agrees
			  // with the tooltip's own moment.
			  hoveredFlow?.t ??
			  hoveredEvent?.t ??
			  hoveredCommit?.commit.time ??
			  (pointerFraction !== null
					? axis.fractionToTime(pointerFraction)
					: undefined)) ?? null;

	const segmentUnit = chooseSegmentUnit(axis.span);
	// Coarser than the hover's segments: every line is on screen at once.
	const grainUnit = chooseGrainUnit(axis.span);
	const boundaries = useMemo(
		() => segmentBoundaries(axis.earliest, axis.latest, grainUnit),
		[axis, grainUnit],
	);

	// A range drag takes over the chart's hint while it lasts.
	const pickingRange = rangeDrag !== null;

	const rangeHint: HintContent | null = rangeDrag && {
		label: formatInterval(
			axis.fractionToTime(Math.min(rangeDrag.from, rangeDrag.to)),
			axis.fractionToTime(Math.max(rangeDrag.from, rangeDrag.to)),
		),
		rows: ['Release to zoom the window to this stretch'],
		fraction: (rangeDrag.from + rangeDrag.to) / 2,
	};

	// Unplayable for too few events or too many (counts only); the title says which.
	const playTitle = !connected
		? 'Not while the connection is down'
		: canPlayTimeline(timeline)
		? "Play this window of the board's history"
		: // Capped, not empty: the server sends counts alone past its cap, so a
		// window with no events but plenty of buckets holds too much to play,
		// not too little. One event fails `canPlayTimeline` too, and has both.
		timeline && timeline.events.length === 0 && timeline.buckets.length > 0
		? 'Too many events in this window to play it — narrow the window'
		: 'Not enough history in this window to play';

	return (
		<ScrubberLayout
			collapsed={collapsed}
			onToggleCollapsed={() => setCollapsed(!collapsed)}
			canPlay={connected && !theatreOpen && canPlayTimeline(timeline)}
			playTitle={playTitle}
			onPlay={onPlayTheatre}
			logOpen={logOpen}
			onChangeLogOpen={onChangeLogOpen}
			standDown={theatreOpen}
			controls={{
				connected,
				scope,
				zoomed: zoom !== null,
				windowOnly,
				following,
				onChangeFollowing,
				// Off the present there is nothing to ride: a checkout and a movie
				// are both somewhere else, and each already drives the board.
				canFollow: connected && !theatreOpen && timeTravel.mode !== 'scrub',
				followTitle: !connected
					? 'Offline — nothing is arriving'
					: theatreOpen
					? 'A movie is playing'
					: timeTravel.mode === 'scrub'
					? 'The board is in the past — put it back at now first'
					: following
					? 'Stop following the newest event'
					: 'Follow the newest event',
				windowFilterable: windowNamesIssues(timeline),
				narrow,
				ticketFocus,
				textFilter,
				onChangeTextFilter,
				layoutMode,
				showIssues,
				showCommits,
				linkedCommitsOnly,
				onChangeLinkedCommitsOnly,
				linesMeasure,
				onChangeLinesMeasure: setLinesMeasure,
				commitRepos,
				hiddenCommitRepos,
				onToggleCommitRepo,
				allBoards,
				onChangeScope: changeScope,
				// Narrowing to the window is about the present: it takes a parked
				// board back to live.
				onChangeWindowOnly: (next: boolean) => {
					onChangeSelection({windowOnly: next});
					if (timeTravel.mode === 'scrub') onReturnToLive();
				},
				onChangeLayoutMode: changeLayoutMode,
				onChangeShowIssues,
				onChangeShowCommits,
				onChangeAllBoards: changeAllBoards,
				boardView,
				identitiesByAxis,
				hiddenIdsByAxis,
				axisStates,
				narrowed: isNarrowed(only),
				categoriesExpanded,
				expandedAxis,
				categoriesFiltered,
				isScrubbing: timeTravel.mode === 'scrub',
				onReturnToLive,
				onToggleAxis: toggleAxisOn,
				onToggleIdentity: toggleIdentity,
				onOnlyIdentity: isolateIdentity,
				onToggleCategoriesExpanded: () =>
					setCategoriesExpanded(!categoriesExpanded),
				onSetExpandedAxis: setExpandedAxis,
			}}
			chart={{
				// Only where it actually hides something.
				scoped:
					windowOnly &&
					isPeriodWindow(scope, zoom !== null) &&
					windowNamesIssues(timeline),
				trackRef,
				pageRef,
				paging,
				axis,
				layoutMode,
				animate,
				windowKey,
				showIssues,
				showCommits,
				issueScatter,
				commitScatter,
				issueBars,
				issueBarRange,
				commitBars,
				commitBarRange,
				linesMeasure,
				lineBars,
				lineBarRange,
				scatterLayers,
				flowChart,
				flowFocusIssue,
				issueSeriesColor: soleIdentity?.color ?? boardViewColor(boardView),
				dragging,
				rangeSelection: rangeDrag,
				// Exits still need their animation, so this only silences a series
				// that has finished arriving.

				commits: drawnCommits,
				hoveredCommitSha: hoveredCommit?.commit.sha ?? null,
				hoveredBucketIndex: pickingRange ? null : hoveredBucketIndex,
				hoveredCommitBucketIndex: pickingRange
					? null
					: hoveredCommitBucketIndex,
				hoveredSegment:
					hoveredSegmentTime !== null && !pickingRange
						? segmentAt(hoveredSegmentTime, segmentUnit)
						: null,
				segmentBoundaries: boundaries,
				// The whole grain segment under the pointer, which the hover may cut finer.
				hoveredGrain:
					hoveredSegmentTime !== null && !pickingRange
						? segmentAt(hoveredSegmentTime, grainUnit)
						: null,
				connected,
				thumbFraction: dragFraction ?? confirmedFraction,
				// Follows a drag, so the stretch moves with the needle rather than
				// waiting for the checkout the drag will ask for.
				unappliedFrom: dragFraction ?? unappliedFrom,
				highlightEventId,
				trackWidthPx: trackRef.current?.clientWidth ?? 0,
				boardHint: pickingRange ? rangeHint : boardHint,
				commitHint: pickingRange ? null : commitHint,
				on: {
					onPageEarlier: () => changeOffset(offset + 1),
					onPageLater: () => changeOffset(offset - 1),
					onPointerDown: event => {
						event.currentTarget.setPointerCapture(event.pointerId);

						const fraction = fractionFromClientX(event.clientX);

						// Off the needle, a press starts a range until it proves a click.
						if (!grabbedNeedleRef.current) {
							rangeDragRef.current = {from: fraction, to: fraction};
							setRangeDrag({from: fraction, to: fraction});
							return;
						}

						dragFractionRef.current = fraction;
						setDragFraction(fraction);
						dispatchScrub(fraction, true);
					},
					onPointerMove: event => {
						// Runs on every move over the scrubber, so only measure mid-drag.
						const range = rangeDragRef.current;
						if (dragFractionRef.current === null && range === null) return;

						const fraction = fractionFromClientX(event.clientX);

						if (range !== null) {
							rangeDragRef.current = {from: range.from, to: fraction};
							setRangeDrag({from: range.from, to: fraction});
							return;
						}

						dragFractionRef.current = fraction;
						setDragFraction(fraction);
						dispatchScrub(fraction, false);
					},
					onPointerEnd: endDrag,
					onGrabNeedle: () => {
						grabbedNeedleRef.current = true;
					},
					onTrackMouseMove: event => {
						if (layoutMode === 'even') {
							setHoveredBucketIndex(bucketIndexFromEvent(event));
							return;
						}

						setPointerFraction(fractionFromEvent(event));
					},
					onTrackMouseLeave: () => {
						setHoveredBucketIndex(null);
						setPointerFraction(null);
					},
					onCommitTrackMouseEnter: () => setHoveredBucketIndex(null),
					onCommitTrackMouseMove: event => {
						event.stopPropagation();
						setHoveredCommitBucketIndex(bucketIndexFromEvent(event));
					},
					onCommitTrackMouseLeave: () => setHoveredCommitBucketIndex(null),
					onScatterPointEnter,
					onScatterPointLeave,
					onFlowPathEnter,
					onFlowPathLeave,
					onPressFlowPath: issue => {
						pressedIssueRef.current = issue;
					},
					onPressCommit: sha => {
						pressedCommitRef.current = sha;
					},
				},
			}}
		/>
	);
};
