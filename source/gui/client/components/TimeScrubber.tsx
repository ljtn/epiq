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
	populatedRange,
	Scope,
	segmentAt,
	useExitTransition,
	usePersistedFlag,
	usePrefersReducedMotion,
} from '../lib/scrubber';
import {HintContent, ScrubberLayout} from './ScrubberLayout';
import {ScatterLayer, ScatterPoint} from './ScrubberParts';
import {GUI_THEME} from '../lib/gui-theme';

const SCRUB_THROTTLE_MS = 120;

// Still needed by the Volume hover, which reads a bucket's count rather than a
// dot. The scatter's own hint comes from dotDetail.
const boardEventRow = (count: number) =>
	`${count} board event${count === 1 ? '' : 's'}`;

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';
const SHOW_ISSUES_STORAGE_KEY = 'epiq.timeScrubber.showIssues';
const SHOW_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.showCommits';
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
	knownIdentities,
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
	// Every tag and person the board knows, per axis, for naming a selected
	// identity the window itself holds no event for.
	knownIdentities: Record<'actor' | 'tag' | 'assignee', GuiEventIdentity[]>;
}) => {
	const {scope, offset, layout: layoutMode, view: boardView, only} = selection;
	const animate = !usePrefersReducedMotion();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);
	// The moment last asked for, so a repeat of it is not asked again.
	const lastTargetRef = useRef<number | null>(null);

	const [dragFraction, setDragFraction] = useState<number | null>(null);

	const [collapsed, setCollapsed] = usePersistedFlag(
		COLLAPSED_STORAGE_KEY,
		false,
	);
	const [showIssues, setShowIssues] = usePersistedFlag(
		SHOW_ISSUES_STORAGE_KEY,
		true,
	);
	const [showCommits, setShowCommits] = usePersistedFlag(
		SHOW_COMMITS_STORAGE_KEY,
		true,
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

	const periodRange = getPeriodRange(scope, offset);

	// periodRange is derived from scope/offset each render, so it is
	// deliberately absent from the dependencies.
	useEffect(() => {
		if (!connected) return;

		pendingRequestId.current = onRequestHistory(
			periodRange?.start,
			periodRange?.end,
			allBoards,
		);
	}, [scope, offset, boardId, allBoards, connected, socketEpoch]);

	const changeLayoutMode = (next: LayoutMode) =>
		onChangeSelection({layout: next});

	const changeScope = (nextScope: Scope) => {
		armEntrance();
		onChangeSelection({scope: nextScope});
	};

	const changeOffset = (nextOffset: number) => {
		armEntrance();
		onChangeSelection({offset: nextOffset});
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
		() => bucketIssueCounts(axis, shown.timeline, boardView, hiddenIdentityIds),
		[axis, shown, boardView, hiddenIdentityIds],
	);
	const commitStats = useMemo(
		() => bucketCommitStats(axis, shown.commits),
		[axis, shown.commits],
	);
	const liveEventDots = useMemo(
		() => buildEventDots(shown.timeline, boardView, hiddenIdentityIds),
		[shown, boardView, hiddenIdentityIds],
	);

	const dragging = dragFraction !== null;

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

	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? axis.fractionForTime(timeTravel.asOfTime)
			: 1;

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
		if (dragFraction === null) return;

		dispatchScrub(dragFraction, true);
		setDragFraction(null);
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

	return (
		<ScrubberLayout
			collapsed={collapsed}
			onToggleCollapsed={() => setCollapsed(!collapsed)}
			controls={{
				connected,
				scope,
				offset,
				periodRange,
				layoutMode,
				showIssues,
				showCommits,
				allBoards,
				onChangeScope: changeScope,
				onChangeOffset: changeOffset,
				onChangeLayoutMode: changeLayoutMode,
				onChangeShowIssues: setShowIssues,
				onChangeShowCommits: setShowCommits,
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
				// Exits still need their animation, so this only silences a series
				// that has finished arriving.

				commits: shown.commits,
				hoveredCommitSha: hoveredCommit?.commit.sha ?? null,
				hoveredBucketIndex,
				hoveredCommitBucketIndex,
				hoveredSegment:
					hoveredSegmentTime !== null
						? segmentAt(hoveredSegmentTime, segmentUnit)
						: null,
				connected,
				thumbFraction: dragFraction ?? confirmedFraction,
				highlightEventId,
				trackWidthPx: trackRef.current?.clientWidth ?? 0,
				boardHint,
				commitHint,
				on: {
					onPointerDown: event => {
						event.currentTarget.setPointerCapture(event.pointerId);

						const fraction = fractionFromClientX(event.clientX);
						setDragFraction(fraction);
						dispatchScrub(fraction, true);
					},
					onPointerMove: event => {
						if (dragFraction === null) return;

						const fraction = fractionFromClientX(event.clientX);
						setDragFraction(fraction);
						dispatchScrub(fraction, false);
					},
					onPointerEnd: endDrag,
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
					onInspectCommit,
				},
			}}
		/>
	);
};
