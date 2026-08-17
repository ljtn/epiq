// The scrubber's logic: what the axis is, what is hovered, what a drag means.
// It computes and hands the result to ScrubberLayout, which owns the markup.

import {useEffect, useRef, useState} from 'react';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {maxOf} from '../../../lib/utils/minmax.js';
import {
	GuiCommitEntry,
	GuiEventTimeline,
	GuiEventTimelineBucket,
	GuiTimeTravelStatus,
} from '../lib/gui-state.model';
import {
	bucketCommitStats,
	bucketIssueCounts,
	buildAxis,
	chooseSegmentUnit,
	clamp,
	DOT_EXIT_TOTAL_MS,
	formatInterval,
	getPeriodRange,
	isScope,
	LayoutMode,
	populatedRange,
	Scope,
	segmentAt,
	useExitTransition,
	usePersistedFlag,
	usePrefersReducedMotion,
} from '../lib/scrubber';
import {HintContent, ScrubberLayout} from './ScrubberLayout';

const SCRUB_THROTTLE_MS = 120;

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';
const SCOPE_STORAGE_KEY = 'epiq.timeScrubber.scope';
const SHOW_ISSUES_STORAGE_KEY = 'epiq.timeScrubber.showIssues';
const SHOW_COMMITS_STORAGE_KEY = 'epiq.timeScrubber.showCommits';
const ALL_BOARDS_STORAGE_KEY = 'epiq.timeScrubber.allBoards';

const readStoredScope = (): Scope => {
	const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
	return isScope(stored) ? stored : 'all';
};

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
	onInspectCommit,
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
	onRequestHistory: (start?: number, end?: number, allBoards?: boolean) => void;
	boardId: string | null;
	connected: boolean;
	onInspectCommit: (sha: string) => void;
}) => {
	const animate = !usePrefersReducedMotion();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);

	const [layoutMode, setLayoutMode] = useState<LayoutMode>('even');
	const [scope, setScope] = useState<Scope>(readStoredScope);
	const [offset, setOffset] = useState(0);
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
		count: number;
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

		onRequestHistory(periodRange?.start, periodRange?.end, allBoards);
	}, [scope, offset, boardId, allBoards, connected]);

	const changeScope = (nextScope: Scope) => {
		armEntrance();
		setScope(nextScope);
		setOffset(0);
		localStorage.setItem(SCOPE_STORAGE_KEY, nextScope);
	};

	const changeOffset = (nextOffset: number) => {
		armEntrance();
		setOffset(nextOffset);
	};

	const changeAllBoards = (next: boolean) => {
		armEntrance();
		setAllBoards(next);
	};

	const axis = buildAxis(timeline, commits);
	const issueCounts = bucketIssueCounts(axis, timeline);
	const commitStats = bucketCommitStats(axis, commits);
	const eventBuckets = timeline?.buckets ?? [];

	// Three maxima, because a coarse bucket's count is a sum of many fine ones;
	// normalizing every series against one max flattens the others.
	const maxIssueBucketCount = maxOf(issueCounts, 1);
	const maxEventCount = maxOf(
		eventBuckets.map(bucket => bucket.count),
		1,
	);
	const maxCommitCount = maxOf(
		Array.from(commitStats.values(), stats => stats.count),
		1,
	);

	const issueBars = issueCounts.flatMap((count, index) =>
		count > 0 ? [{index, intensity: count / maxIssueBucketCount}] : [],
	);
	const commitBars = Array.from(commitStats, ([index, stats]) => ({
		index,
		intensity: stats.count / maxCommitCount,
	}));

	// The entrance belongs to a view the user asked for, never to data turning
	// up on its own. Options that refetch arm it, and it fires when the window
	// they asked for lands — animating on the click would run it against the
	// previous window and restart mid-flight. A background refresh finds it
	// unarmed and updates the bars in place.
	const [entrance, setEntrance] = useState(0);
	const armed = useRef(true);
	const seenHistoryId = useRef(historyId);

	// Armed by the handlers below rather than by an effect on derived values: a
	// board id that momentarily changes identity while state reloads would
	// otherwise count as a view change.
	const armEntrance = () => {
		armed.current = true;
	};

	useEffect(armEntrance, [boardId]);

	useEffect(() => {
		if (seenHistoryId.current === historyId) return;
		seenHistoryId.current = historyId;

		if (!armed.current) return;
		armed.current = false;
		setEntrance(generation => generation + 1);
	}, [historyId]);

	// layoutMode is in the key rather than armed: switching Volume/Events draws
	// the window already in hand, so it animates at once.
	const windowKey = `${layoutMode}-${entrance}`;

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
		const now = Date.now();
		if (!force && now - lastDispatchRef.current < SCRUB_THROTTLE_MS) return;

		lastDispatchRef.current = now;
		onScrub(axis.fractionToTime(fraction));
	};

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

	const boardEventRow = (count: number) =>
		`${count} board event${count === 1 ? '' : 's'}`;

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
					rows: [boardEventRow(hoveredEvent.count)],
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
			scrubbingAsOf={
				timeTravel.mode === 'scrub'
					? timeTravel.asOfTime
						? formatDateTime(new Date(timeTravel.asOfTime))
						: ''
					: null
			}
			controls={{
				scope,
				offset,
				periodRange,
				layoutMode,
				showIssues,
				showCommits,
				allBoards,
				isScrubbing: timeTravel.mode === 'scrub',
				nowLabel:
					scope === 'all' || offset === 0
						? 'Now'
						: formatDateTime(new Date(axis.latest)),
				onChangeScope: changeScope,
				onChangeOffset: changeOffset,
				onChangeLayoutMode: setLayoutMode,
				onChangeShowIssues: setShowIssues,
				onChangeShowCommits: setShowCommits,
				onChangeAllBoards: changeAllBoards,
				onReturnToLive,
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
				issueBarRange: populatedRange(issueBars),
				commitBars,
				commitBarRange: populatedRange(commitBars),
				eventBuckets,
				maxEventCount,
				commits,
				hoveredCommitSha: hoveredCommit?.commit.sha ?? null,
				hoveredBucketIndex,
				hoveredCommitBucketIndex,
				hoveredSegment:
					hoveredSegmentTime !== null
						? segmentAt(hoveredSegmentTime, segmentUnit)
						: null,
				thumbFraction: dragFraction ?? confirmedFraction,
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
					onIssueDotEnter: (bucket: GuiEventTimelineBucket) =>
						setHoveredEvent({
							label: formatDateTime(new Date(bucket.t)),
							count: bucket.count,
							t: bucket.t,
							fraction: axis.fractionForTime(bucket.t),
						}),
					onIssueDotLeave: () => setHoveredEvent(null),
					onCommitDotEnter: (commit: GuiCommitEntry) =>
						setHoveredCommit({
							commit,
							fraction: axis.fractionForTime(commit.time),
						}),
					onCommitDotLeave: () => setHoveredCommit(null),
					onInspectCommit,
				},
			}}
		/>
	);
};
