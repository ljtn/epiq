// The scrubber's logic: what the axis is, what is hovered, what a drag means.
// It computes and hands the result to ScrubberLayout, which owns the markup.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {maxOf} from '../../../lib/utils/minmax.js';
import {
	GuiCommitEntry,
	GuiEventIdentity,
	GuiEventTimeline,
	GuiTimeTravelStatus,
} from '../lib/gui-state.model';
import {
	BoardSelection,
	hiddenIdsFor,
	isolateOnly,
	toggleOnly,
	withSelectedIdentities,
} from '../lib/board-selection';
import {
	bucketCommitStats,
	bucketIssueCounts,
	buildAxis,
	boardViewColor,
	BoardView,
	buildEventDots,
	chooseSegmentUnit,
	clamp,
	DOT_EXIT_TOTAL_MS,
	dotDetail,
	EventDot,
	identityAxisFor,
	listIdentities,
	soleVisibleIdentity,
	formatInterval,
	getPeriodRange,
	hourFractionForTime,
	LayoutMode,
	MIN_RANGE_DRAG_PX,
	MIN_ZOOM_SPAN_MS,
	populatedRange,
	Scope,
	segmentAt,
	useExitTransition,
	isPeriodWindow,
	useNarrowBar,
	usePrefersReducedMotion,
	windowNamesIssues,
} from '../lib/scrubber';
import {usePersistedFlag} from '../lib/use-persisted-flag';
import {canPlayTimeline} from '../lib/theatre';
import {HintContent, ScrubberLayout} from './ScrubberLayout';
import {ScatterLayer, ScatterPoint} from './ScatterCanvas';
import {GUI_THEME} from '../lib/gui-theme';

const SCRUB_THROTTLE_MS = 120;

// Still needed by the Volume hover, which reads a bucket's count rather than a
// dot. The scatter's own hint comes from dotDetail.
const boardEventRow = (count: number) =>
	`${count} board event${count === 1 ? '' : 's'}`;

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';
const ALL_BOARDS_STORAGE_KEY = 'epiq.timeScrubber.allBoards';
const CATEGORIES_EXPANDED_STORAGE_KEY = 'epiq.timeScrubber.categoriesExpanded';
const IDENTITIES_EXPANDED_STORAGE_KEY = 'epiq.timeScrubber.identitiesExpanded';

export const TimeScrubber = ({
	timeline,
	commits,
	historyId,
	timeTravel,
	onScrub,
	onReturnToLive,
	onRequestHistory,
	boardId,
	connected,
	socketEpoch,
	highlightEventId,
	onInspectCommit,
	selection,
	onChangeSelection,
	selectedIssue,
	knownIdentities,
	refreshOn,
	onPlayTheatre,
	theatreOpen,
	logOpen,
	onChangeLogOpen,
	showIssues,
	onChangeShowIssues,
	showCommits,
	onChangeShowCommits,
}: {
	timeline: GuiEventTimeline | null;
	commits: GuiCommitEntry[];
	// Identifies the window `timeline` and `commits` came from.
	historyId: number;
	timeTravel: GuiTimeTravelStatus;
	onScrub: (targetTime: number) => void;
	onReturnToLive: () => void;
	// Undefined start/end asks for the default "all time" window. Both series
	// must come from one call: they share an axis derived from both, so
	// independent fetches can put a half-updated pair on screen.
	// Returns the id its reply will carry.
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
	// Owned above rather than here: the selection that colours the chart is the
	// same one that decides which tickets the board shows, and it lives in the
	// URL.
	selection: BoardSelection;
	onChangeSelection: (patch: Partial<BoardSelection>) => void;
	// The ticket whose details are open, which the "Ticket only" narrowing
	// needs for both halves of what it does: its id filters the events, and the
	// moment it was created is where its window starts. Null with none open,
	// which is what greys that checkbox out.
	selectedIssue: {id: string; createdAt: number} | null;
	// Every tag and person the board knows, per axis, for naming a selected
	// identity the window itself holds no event for.
	knownIdentities: Record<'actor' | 'tag' | 'assignee', GuiEventIdentity[]>;
	// Anything whose identity changing means the window has to be asked for
	// again. The window is otherwise fetched only when it moves, which is fine
	// while it is just a picture — but two things read it as live data. Once it
	// decides which tickets the board shows, a ticket filed since the last fetch
	// is missing from it and would be hidden from the board it has just joined;
	// and once the log is drawn from it, an event made since the last fetch
	// never reaches the panel that is supposed to be listing it.
	refreshOn: unknown;
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
		view: boardView,
		only,
		windowOnly,
		ticketOnly,
	} = selection;
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
	// Set by the needle's own press, which fires before the track's: it says
	// this drag moves the needle rather than dragging out a range.
	const grabbedNeedleRef = useRef(false);
	// Likewise from the scatter, naming the commit a press landed on. A click on
	// a dot opens its diff instead of time travelling; a drag from one is a range
	// like any other. Cleared at the end of every gesture, so a press that never
	// crosses the canvas cannot inherit it.
	const pressedCommitRef = useRef<string | null>(null);

	const [collapsed, setCollapsed] = usePersistedFlag(
		COLLAPSED_STORAGE_KEY,
		false,
	);
	const [categoriesExpanded, setCategoriesExpanded] = usePersistedFlag(
		CATEGORIES_EXPANDED_STORAGE_KEY,
		false,
	);
	const [identitiesExpanded, setIdentitiesExpanded] = usePersistedFlag(
		IDENTITIES_EXPANDED_STORAGE_KEY,
		false,
	);
	// Unlike the series toggles this changes what is fetched, not just what is
	// drawn.
	const [allBoards, setAllBoards] = usePersistedFlag(
		ALL_BOARDS_STORAGE_KEY,
		false,
	);

	// Only the scatter retracts on its way out. The bar charts have no per-bar
	// exit to wait for, so outside "Events" the duration is zero and unticking
	// stays immediate.
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
	// Resolved arithmetically from the pointer's x rather than by per-bucket hit
	// targets: at wide spans a bucket is only ~2px across.
	const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(
		null,
	);
	const [hoveredCommitBucketIndex, setHoveredCommitBucketIndex] = useState<
		number | null
	>(null);

	// Only while a ticket is actually open: the checkbox can be left ticked by
	// a link, and a window starting at a ticket that is not on screen would be
	// a stretch nobody chose.
	const ticketFocus = ticketOnly && selectedIssue !== null;

	// The ticket's whole life, which stands in front of a dragged-out window
	// the way that one stands in front of the rolling period. Derived rather
	// than written into the selection, so unticking hands back what was there.
	const ticketRange = ticketFocus
		? {start: selectedIssue.createdAt, end: Date.now()}
		: null;

	// The events this narrowing keeps. Null leaves every ticket's events in.
	const issueOnly = ticketFocus ? selectedIssue.id : null;

	// Which ticket the window is cut from, and null whenever it is not cut from
	// one. Only while the narrowing is on does a different ticket mean a
	// different window to ask the server for; listing the open ticket itself
	// would refetch the whole timeline on every click between two of them,
	// which is most clicks and none of them a change of window.
	const ticketWindowKey = ticketFocus
		? `${selectedIssue.id}:${selectedIssue.createdAt}`
		: null;

	// A dragged-out window stands in for the rolling one, and is the only kind
	// with fixed bounds — every other is anchored to now.
	const periodRange = ticketRange ?? zoom ?? getPeriodRange(scope, offset);

	// periodRange is derived from scope/offset each render, so it is
	// deliberately absent from the dependencies; the zoom's own bounds are
	// listed instead, since it is a fresh object on every read of the URL. The
	// ticket window is the same: anchored to now like the rolling one, so what
	// is listed is the ticket it is cut from rather than the range itself.
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

	// Naming a scope is also the only way out of a zoom, which
	// applySelectionPatch clears for any patch that names one — including a
	// patch naming the scope already held, since while zoomed no scope button
	// reads as pressed and every one of them is a way out.
	const changeScope = (nextScope: Scope) => {
		armEntrance();
		onChangeSelection({scope: nextScope});
	};

	// Under a zoom there are no periods to count back, so the pager slides the
	// window by its own width instead — one press back is the stretch before the
	// one on screen.
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

	// The scope is left as it was rather than inferred from the span: nothing
	// reads it while a zoom is up. The chart's bucketing and segment unit come
	// off the axis span, the pager slides by the window's own width, and the
	// label dates the window — so the only scope that matters is the one named
	// on the way out.
	const zoomToRange = (from: number, to: number) => {
		const start = Math.min(from, to);
		const span = Math.max(MIN_ZOOM_SPAN_MS, Math.abs(to - from));

		armEntrance();
		onChangeSelection({zoom: {start, end: start + span}});
	};

	// No armEntrance on either: the window is unchanged, so these filter what is
	// already in hand rather than asking for a new view.
	const changeBoardView = (next: BoardView) => onChangeSelection({view: next});

	// Toggles: isolating again restores the rest, so the button is a way back as
	// well as a way in. Ticking each of a dozen tags to undo it is not.
	const isolateIdentity = (id: string) =>
		onChangeSelection({only: isolateOnly(only, id)});

	const toggleIdentity = (id: string, next: boolean) =>
		onChangeSelection({only: toggleOnly(only, identities, id, next)});

	const changeAllBoards = (next: boolean) => {
		armEntrance();
		setAllBoards(next);
	};

	// What narrows the window already in hand. Answered on the spot, with no
	// round trip, so it can replay the entrance the moment it changes.
	const filterKey = useMemo(
		() => JSON.stringify([boardView, only === null ? null : [...only].sort()]),
		[boardView, only],
	);

	const entrance = useRef(0);
	const armed = useRef(true);

	const armEntrance = () => {
		armed.current = true;
	};

	// Only the reply to the window this chart asked for. Taking whichever
	// history arrived next meant a reply still in flight for the window just
	// left could land first and be shown instead, and the real one was then
	// ignored — the chart stuck on the previous scope.
	const shownRef = useRef({timeline, commits});
	const pendingRequestId = useRef<number | null>(null);

	if (
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

	const identities = useMemo(() => {
		const axis = identityAxisFor(boardView);

		return withSelectedIdentities(
			listIdentities(shown.timeline, boardView),
			only,
			axis === null ? [] : knownIdentities[axis],
		);
	}, [shown, boardView, only, knownIdentities]);

	const hiddenIdentityIds = useMemo(
		() => hiddenIdsFor(identities, only),
		[identities, only],
	);

	// Filtered down to one tag or person, the bars are that identity and nothing
	// else, so they take its colour rather than the kind's. The scatter already
	// colours per identity, so this is what keeps the two layout modes agreeing.
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
				issueOnly,
			),
		[axis, shown, boardView, hiddenIdentityIds, issueOnly],
	);
	const commitStats = useMemo(
		() => bucketCommitStats(axis, shown.commits),
		[axis, shown.commits],
	);
	const liveEventDots = useMemo(
		() =>
			buildEventDots(shown.timeline, boardView, hiddenIdentityIds, issueOnly),
		[shown, boardView, hiddenIdentityIds, issueOnly],
	);

	const dragging = dragFraction !== null || rangeDrag !== null;

	// Both series as one list for the canvas, in the order they should stack:
	// commits first, board events over them, as the old zIndex did.
	const commitPoints = useMemo(
		(): ScatterPoint[] =>
			shown.commits.map(commit => ({
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
					commit.author
				} (${commit.linesChanged.toLocaleString()} lines)`,
				commitSha: commit.sha,
			})),
		[shown.commits, axis],
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

	// Two maxima, because a coarse bucket's count is a sum of many fine ones;
	// normalizing every series against one max flattens the others. The scatter
	// needs no maximum of its own: buildEventDots sizes its dots.
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

	// Null when the moment the needle stands for is not in the window, so it is
	// not drawn rather than drawn somewhere it is not. fractionForTime clamps,
	// so a moment off either end would otherwise pin the needle to that edge and
	// read as "the board is parked here" — pointing at a time the window does
	// not contain.
	//
	// While live it stands for the present, which is in the window exactly when
	// the window runs up to it. That is read off the selection rather than by
	// comparing against the clock: an "up to now" window is only fetched up to
	// the moment it was asked for, so seconds later the clock is already past
	// its end and the needle would blink out.
	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? timeTravel.asOfTime >= axis.earliest &&
			  timeTravel.asOfTime <= axis.latest
				? axis.fractionForTime(timeTravel.asOfTime)
				: null
			: atLatest
			? 1
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

		// The player is driving the board's position. Pointer events cannot reach
		// the chart while it is up, but a drag begun before it opened still ends
		// somewhere.
		if (theatreOpen) return;

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

		if (dragFraction !== null) {
			dispatchScrub(dragFraction, true);
			setDragFraction(null);
			return;
		}

		if (rangeDrag === null) return;

		const {from, to} = rangeDrag;
		setRangeDrag(null);

		const trackWidth = trackRef.current?.clientWidth ?? 0;

		// Pressed and released on one spot: a click. Only a drag wide enough to
		// have been aimed is read as a range.
		if (Math.abs(to - from) * trackWidth < MIN_RANGE_DRAG_PX) {
			// A click that began on a commit dot was aimed at the commit, so it
			// opens the diff rather than time travelling. The dot pressed decides
			// it, not whatever the release happens to land on.
			if (pressedCommit !== null) {
				onInspectCommit(pressedCommit);
				return;
			}

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
				const commit = shown.commits.find(c => c.sha === point.commitSha);
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
		[shown.commits],
	);

	const onScatterPointLeave = useCallback(() => {
		setHoveredEvent(null);
		setHoveredCommit(null);
	}, []);

	const hoveredBucketTime = bucketTimeAt(hoveredBucketIndex);
	const hoveredBucketCount =
		hoveredBucketIndex !== null ? issueCounts[hoveredBucketIndex] : undefined;
	const boardHint: HintContent | null =
		layoutMode === 'even'
			? hoveredBucketTime !== undefined && hoveredBucketCount !== undefined
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
		layoutMode === 'even'
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
							`${hoveredCommitStats.linesChanged.toLocaleString()} lines changed`,
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
							hoveredCommit.commit.author
						} • ${hoveredCommit.commit.linesChanged.toLocaleString()} lines`,
					],
					fraction: hoveredCommit.fraction,
			  }
			: null;

	// Deliberately one segment for both tracks: hovering a commit lights up the
	// same day in the issue track above, which is what makes the two halves read
	// as one time grid.
	const hoveredSegmentTime =
		(layoutMode === 'even'
			? hoveredBucketTime ?? bucketTimeAt(hoveredCommitBucketIndex)
			: // A hovered point wins over the raw pointer, so the highlight agrees
			  // with the tooltip's own moment.
			  hoveredEvent?.t ??
			  hoveredCommit?.commit.time ??
			  (pointerFraction !== null
					? axis.fractionToTime(pointerFraction)
					: undefined)) ?? null;

	const segmentUnit = chooseSegmentUnit(axis.span);

	// Everything hover puts on the chart is about the bucket under the pointer,
	// which is not what a range drag is asking about — and it is drawn over the
	// stretch being picked. So the drag takes the chart over while it lasts, and
	// says what it has covered so far in place of the hover's own hint.
	const pickingRange = rangeDrag !== null;

	const rangeHint: HintContent | null = rangeDrag && {
		label: formatInterval(
			axis.fractionToTime(Math.min(rangeDrag.from, rangeDrag.to)),
			axis.fractionToTime(Math.max(rangeDrag.from, rangeDrag.to)),
		),
		rows: ['Release to zoom the window to this stretch'],
		fraction: (rangeDrag.from + rangeDrag.to) / 2,
	};

	// A window can be unplayable for opposite reasons: too little in it, or so
	// much that the server sent counts alone and named no moments to walk. The
	// same disabled button stands for both, so the title has to separate them.
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
				offset,
				periodRange,
				zoomed: zoom !== null,
				atLatest,
				windowOnly,
				windowFilterable: windowNamesIssues(timeline),
				narrow,
				ticketOnly,
				ticketSelected: selectedIssue !== null,
				ticketFocus,
				layoutMode,
				showIssues,
				showCommits,
				allBoards,
				onChangeScope: changeScope,
				onChangeOffset: changeOffset,
				onChangeWindowOnly: (next: boolean) =>
					onChangeSelection({windowOnly: next}),
				onChangeTicketOnly: (next: boolean) =>
					onChangeSelection({ticketOnly: next}),
				onChangeLayoutMode: changeLayoutMode,
				onChangeShowIssues,
				onChangeShowCommits,
				onChangeAllBoards: changeAllBoards,
				boardView,
				identities,
				hiddenIdentityIds,
				categoriesExpanded,
				identitiesExpanded,
				categoriesFiltered,
				isScrubbing: timeTravel.mode === 'scrub',
				onReturnToLive,
				onChangeBoardView: changeBoardView,
				onToggleIdentity: toggleIdentity,
				onOnlyIdentity: isolateIdentity,
				onToggleCategoriesExpanded: () =>
					setCategoriesExpanded(!categoriesExpanded),
				onSetIdentitiesExpanded: setIdentitiesExpanded,
			}}
			chart={{
				// Only where it is actually hiding something: ticked over a window
				// that narrows nothing draws no outline, the way the box itself goes
				// flat there.
				scoped:
					windowOnly &&
					isPeriodWindow(scope, zoom !== null) &&
					windowNamesIssues(timeline),
				trackRef,
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
				scatterLayers,
				issueSeriesColor: soleIdentity?.color ?? boardViewColor(boardView),
				dragging,
				rangeSelection: rangeDrag,
				// Exits still need their animation, so this only silences a series
				// that has finished arriving.

				commits: shown.commits,
				hoveredCommitSha: hoveredCommit?.commit.sha ?? null,
				hoveredBucketIndex: pickingRange ? null : hoveredBucketIndex,
				hoveredCommitBucketIndex: pickingRange
					? null
					: hoveredCommitBucketIndex,
				hoveredSegment:
					hoveredSegmentTime !== null && !pickingRange
						? segmentAt(hoveredSegmentTime, segmentUnit)
						: null,
				connected,
				thumbFraction: dragFraction ?? confirmedFraction,
				highlightEventId,
				trackWidthPx: trackRef.current?.clientWidth ?? 0,
				boardHint: pickingRange ? rangeHint : boardHint,
				commitHint: pickingRange ? null : commitHint,
				on: {
					onPointerDown: event => {
						event.currentTarget.setPointerCapture(event.pointerId);

						const fraction = fractionFromClientX(event.clientX);

						// Off the needle, a press is the corner of a range until it turns
						// out to have been a click. Scrubbing on the way would checkout
						// every moment swept over on the way to picking a window.
						if (!grabbedNeedleRef.current) {
							setRangeDrag({from: fraction, to: fraction});
							return;
						}

						setDragFraction(fraction);
						dispatchScrub(fraction, true);
					},
					onPointerMove: event => {
						// The handler is on the wrapper, so this runs for every move over
						// the whole scrubber. Measuring the track is a layout read, and
						// nothing outside a drag has a use for it.
						if (dragFraction === null && rangeDrag === null) return;

						const fraction = fractionFromClientX(event.clientX);

						if (rangeDrag !== null) {
							setRangeDrag({from: rangeDrag.from, to: fraction});
							return;
						}

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
					onPressCommit: sha => {
						pressedCommitRef.current = sha;
					},
				},
			}}
		/>
	);
};
