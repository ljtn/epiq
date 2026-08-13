import {useEffect, useRef, useState} from 'react';
import {
	GuiCommitEntry,
	GuiEventTimeline,
	GuiEventTimelineBucket,
	GuiTimeTravelStatus,
} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconClock} from './IconClock';
import {Panel} from './Panel';

// Not reused from source/lib/event/date-utils.ts: that module is reachable
// (via event.model -> app-state.model -> action-map.model) from Node-only TUI
// code (readline, the command parser), which breaks the browser client's type
// program if pulled in. This copy is trivial enough to duplicate.
const formatDateTime = (date: Date): string => {
	const pad = (n: number) => String(n).padStart(2, '0');

	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())} ` +
		`${pad(date.getHours())}:` +
		`${pad(date.getMinutes())}`
	);
};

// A frame represents a time interval, not a single instant — show it as a
// range. Collapses the end side to just a time when it falls on the same day
// as the start, since repeating the date is noise at typical bucket sizes.
const formatInterval = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const pad = (n: number) => String(n).padStart(2, '0');

	const sameDay =
		startDate.getFullYear() === endDate.getFullYear() &&
		startDate.getMonth() === endDate.getMonth() &&
		startDate.getDate() === endDate.getDate();

	const endLabel = sameDay
		? `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`
		: formatDateTime(endDate);

	return `${formatDateTime(startDate)} – ${endLabel}`;
};

type TimeScrubberProps = {
	timeline: GuiEventTimeline | null;
	commits: GuiCommitEntry[];
	timeTravel: GuiTimeTravelStatus;
	onScrub: (targetTime: number) => void;
	onReturnToLive: () => void;
	// Undefined start/end asks for the default "all time" window.
	onRequestTimeline: (start?: number, end?: number) => void;
	onRequestCommits: (start?: number, end?: number) => void;
	onInspectCommit: (sha: string) => void;
};

// "even" lays every non-empty bucket out as an equal-width contiguous frame
// (a filmstrip, no gaps for quiet stretches) — the default, since quiet
// stretches otherwise read as empty void. "real" positions frames
// proportionally to actual elapsed time, gaps and all.
type LayoutMode = 'even' | 'real';

// "all" is the full project history. The others scope + zoom the timeline to
// a single calendar period, which — since the server buckets a fixed count
// across whatever window it's given — is what makes narrower scopes more
// precise for free.
type Scope = 'all' | 'week' | 'month' | 'year';

type PeriodRange = {start: number; end: number};

// How often a drag dispatches `onScrub` while the pointer is moving. The
// visual thumb still tracks every pointer move locally.
const SCRUB_THROTTLE_MS = 120;

// Width of the floating hover-hint tooltip, used both to render it and to
// clamp its position so it never overflows past the track's edges. Wraps to
// multiple lines rather than truncating, so wide enough to keep that from
// looking cramped, but not so wide it swamps the narrow track it floats over.
const HOVER_HINT_WIDTH = 220;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
	background: active ? GUI_THEME.accent : 'transparent',
	border: `1px solid ${active ? GUI_THEME.accent : GUI_THEME.dim}`,
	color: active ? GUI_THEME.bg : GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 8px',
	cursor: 'pointer',
});

const navButtonStyle: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.dim}`,
	color: GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 6px',
	cursor: 'pointer',
	lineHeight: 1,
};

const COLLAPSED_STORAGE_KEY = 'epiq.timeScrubber.collapsed';

// Rolling window `offset` periods back from now — plain duration arithmetic,
// not calendar-boundary snapping. offset 0 = the most recent N days ending
// now; offset 1 = the N days before that; etc.
const SCOPE_DURATION_MS: Record<Exclude<Scope, 'all'>, number> = {
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

const getPeriodRange = (scope: Scope, offset: number): PeriodRange | null => {
	if (scope === 'all') return null;

	const durationMs = SCOPE_DURATION_MS[scope];
	const end = Date.now() - offset * durationMs;
	const start = end - durationMs;

	return {start, end};
};

const formatPeriodLabel = (
	scope: Scope,
	offset: number,
	range: PeriodRange | null,
): string => {
	if (scope === 'all' || !range) return 'All time';

	if (offset === 0) {
		return scope === 'week'
			? 'Last 7 days'
			: scope === 'month'
			? 'Last 30 days'
			: 'Last 365 days';
	}

	const start = new Date(range.start);
	const end = new Date(range.end);
	return `${start.getMonth() + 1}/${start.getDate()} – ${
		end.getMonth() + 1
	}/${end.getDate()}`;
};

export const TimeScrubber = ({
	timeline,
	commits,
	timeTravel,
	onScrub,
	onReturnToLive,
	onRequestTimeline,
	onRequestCommits,
	onInspectCommit,
}: TimeScrubberProps) => {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const lastDispatchRef = useRef(0);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>('even');
	const [scope, setScope] = useState<Scope>('all');
	const [offset, setOffset] = useState(0);
	const [dragFraction, setDragFraction] = useState<number | null>(null);
	// `time` always renders as the tooltip's first row, for both this (board)
	// and the commit tooltip below — a consistent anchor regardless of what
	// other stats follow.
	const [hoverLabel, setHoverLabel] = useState<{
		time: string;
		count: number;
	} | null>(null);
	const [hoveredFrameTime, setHoveredFrameTime] = useState<number | null>(null);
	const [hoveredFrameFraction, setHoveredFrameFraction] = useState<
		number | null
	>(null);
	const [needleHovered, setNeedleHovered] = useState(false);
	const [hoveredCommit, setHoveredCommit] = useState<GuiCommitEntry | null>(
		null,
	);
	const [hoveredCommitFraction, setHoveredCommitFraction] = useState<
		number | null
	>(null);
	// Only used in "even"/Frames mode, where commits render as one aggregated
	// bar per bucket instead of individual dots (see hoveredCommit above).
	const [hoveredCommitBucket, setHoveredCommitBucket] = useState<{
		index: number;
		count: number;
		linesChanged: number;
	} | null>(null);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true',
	);

	const toggleCollapsed = () => {
		setCollapsed(next => {
			const nextCollapsed = !next;
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nextCollapsed));
			return nextCollapsed;
		});
	};

	const periodRange = getPeriodRange(scope, offset);

	// Deliberately keyed on scope/offset only — onRequestTimeline/onRequestCommits
	// are stable useCallbacks from the parent, and periodRange is derived from
	// scope/offset each render, so including either would just be redundant.
	useEffect(() => {
		onRequestTimeline(periodRange?.start, periodRange?.end);
		onRequestCommits(periodRange?.start, periodRange?.end);
	}, [scope, offset]);

	const changeScope = (nextScope: Scope) => {
		setScope(nextScope);
		setOffset(0);
	};

	const commitTimes = commits.map(c => c.time);

	// `timeline.buckets` only has slots where an issue event actually
	// happened (sparse by design — see the server's comment on
	// TIMELINE_BUCKET_COUNT). That's fine for the issue track itself, but
	// commits routinely predate the board's earliest issue *within whatever
	// window is selected* (the codebase is usually older than its issue
	// tracker, and even a narrow "Week" scope can have its first commit
	// hours before its first issue event) — with no real bucket to land in,
	// those commits snapped onto the single earliest existing bucket, making
	// it a false outlier. Synthesize empty (count: 0) placeholder buckets to
	// cover that gap, at the same grid width, so old commits get real,
	// evenly-spaced slots instead. Capped by how many commits actually need
	// placing there — there's no benefit to more buckets than that, and
	// capping by the real issue-bucket count instead (as opposed to commit
	// count) still let a short "Week" window's handful of real buckets get
	// swamped by a wall of empty ones.
	const frames = (() => {
		const issueFrames = timeline?.buckets ?? [];
		const bucketMs = timeline?.bucketMs ?? 0;
		if (bucketMs <= 0 || issueFrames.length === 0 || commitTimes.length === 0)
			return issueFrames;

		const firstIssueTime = issueFrames[0]!.t;
		const prefixCommitTimes = commitTimes.filter(t => t < firstIssueTime);
		if (prefixCommitTimes.length === 0) return issueFrames;

		const earliestCommitTime = Math.min(...prefixCommitTimes);
		const prefixSpan = firstIssueTime - earliestCommitTime;

		const maxPrefixBuckets = prefixCommitTimes.length;
		const prefixBucketMs = Math.max(
			bucketMs,
			Math.ceil(prefixSpan / maxPrefixBuckets),
		);
		const prefixBucketCount = Math.min(
			maxPrefixBuckets,
			Math.ceil(prefixSpan / prefixBucketMs),
		);

		const prefix: GuiEventTimelineBucket[] = [];
		for (let i = prefixBucketCount; i >= 1; i--) {
			prefix.push({t: firstIssueTime - i * prefixBucketMs, count: 0});
		}

		return [...prefix, ...issueFrames];
	})();

	// Widened to cover commits too (they often predate the earliest issue
	// event, especially in "All time" scope) — both rows share this axis, so
	// a dot at a given x always means the same time in either row.
	const earliest = Math.min(
		frames[0]?.t ?? timeline?.earliest ?? Date.now(),
		...(commitTimes.length ? commitTimes : [Date.now()]),
	);
	const latest = Math.max(
		timeline?.latest ?? Date.now(),
		...(commitTimes.length ? commitTimes : [Date.now()]),
	);
	const span = Math.max(1, latest - earliest);

	// Position of a real event time along the track, proportional to elapsed
	// time (the "real" layout's coordinate system).
	const realFractionForTime = (time: number) =>
		clamp((time - earliest) / span, 0, 1);

	// Position of the frame nearest a given time, centered in its equal-width
	// slot (the "even" layout's coordinate system).
	const evenFractionForTime = (time: number) => {
		if (frames.length === 0) return 1;

		const index = nearestFrameIndex(time);
		return (index + 0.5) / frames.length;
	};

	const nearestFrameIndex = (time: number): number => {
		let bestIndex = 0;
		let bestDiff = Infinity;

		frames.forEach((frame, index) => {
			const diff = Math.abs(frame.t - time);
			if (diff < bestDiff) {
				bestDiff = diff;
				bestIndex = index;
			}
		});

		return bestIndex;
	};

	const confirmedFraction =
		timeTravel.mode === 'scrub' && timeTravel.asOfTime !== null
			? layoutMode === 'even'
				? evenFractionForTime(timeTravel.asOfTime)
				: realFractionForTime(timeTravel.asOfTime)
			: 1;

	const thumbFraction = dragFraction ?? confirmedFraction;

	// Maps a pointer's fraction along the track to a target time, in whichever
	// coordinate system is active. "even" snaps to the nearest frame's actual
	// time; "real" interpolates continuously across the elapsed span.
	const fractionToTime = (fraction: number) => {
		if (layoutMode === 'even') {
			if (frames.length === 0) return latest;

			const index = clamp(
				Math.floor(fraction * frames.length),
				0,
				frames.length - 1,
			);
			return frames[index]!.t;
		}

		return Math.round(earliest + clamp(fraction, 0, 1) * span);
	};

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
		onScrub(fractionToTime(fraction));
	};

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);

		const fraction = fractionFromClientX(event.clientX);
		setDragFraction(fraction);
		dispatchScrub(fraction, true);
	};

	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (dragFraction === null) return;

		const fraction = fractionFromClientX(event.clientX);
		setDragFraction(fraction);
		dispatchScrub(fraction, false);
	};

	const endDrag = () => {
		if (dragFraction === null) return;

		dispatchScrub(dragFraction, true);
		setDragFraction(null);
	};

	const maxCount = Math.max(1, ...frames.map(b => b.count));

	// In "even"/Frames mode, commits render as one aggregated bar per bucket
	// (same buckets/x-slots as the issue frames above) rather than individual
	// dots. Bar height is driven by commit count, the same metric (and the
	// same linear formula) the issue frame bars above use — keeping both
	// halves of the mirrored "iceberg" on equal footing. `linesChanged` is
	// still tracked per commit and surfaced in the hover tooltip below, just
	// not used for sizing right now.
	const commitStatsByFrameIndex = new Map<
		number,
		{count: number; linesChanged: number}
	>();
	if (frames.length > 0) {
		for (const commit of commits) {
			const index = nearestFrameIndex(commit.time);
			const existing = commitStatsByFrameIndex.get(index) ?? {
				count: 0,
				linesChanged: 0,
			};
			commitStatsByFrameIndex.set(index, {
				count: existing.count + 1,
				linesChanged: existing.linesChanged + commit.linesChanged,
			});
		}
	}
	const maxCommitCount = Math.max(
		1,
		...Array.from(commitStatsByFrameIndex.values(), s => s.count),
	);

	// Center the hover-hint tooltip on the hovered frame, clamped so it never
	// overflows past the track's own left/right edges.
	const trackWidthPx = trackRef.current?.clientWidth ?? 0;
	const hoverHintLeftPx =
		hoveredFrameFraction !== null
			? clamp(
					hoveredFrameFraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
					0,
					Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			  )
			: 0;

	// Unifies the two commit-hover sources (a single dot in "real" mode, an
	// aggregated bucket bar in "even" mode) into one time/rows shape so the
	// floating hint below only needs one code path — `time` is always the
	// first row, matching the board tooltip's own top row.
	const commitHoverLabel: {time: string; rows: string[]} | null =
		layoutMode === 'even'
			? hoveredCommitBucket
				? {
						time: formatInterval(
							frames[hoveredCommitBucket.index]!.t,
							frames[hoveredCommitBucket.index]!.t + (timeline?.bucketMs ?? 0),
						),
						rows: [
							`${hoveredCommitBucket.count} commit${
								hoveredCommitBucket.count === 1 ? '' : 's'
							}`,
							`${hoveredCommitBucket.linesChanged.toLocaleString()} lines changed`,
						],
				  }
				: null
			: hoveredCommit
			? {
					time: formatDateTime(new Date(hoveredCommit.time)),
					rows: [
						hoveredCommit.subject,
						`${
							hoveredCommit.author
						} • ${hoveredCommit.linesChanged.toLocaleString()} lines`,
					],
			  }
			: null;
	const commitHoverFraction =
		layoutMode === 'even'
			? hoveredCommitBucket
				? (hoveredCommitBucket.index + 0.5) / frames.length
				: null
			: hoveredCommitFraction;
	const commitHintLeftPx =
		commitHoverFraction !== null
			? clamp(
					commitHoverFraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
					0,
					Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			  )
			: 0;

	return (
		<Panel
			as="div"
			borderColor={GUI_THEME.line}
			borderRadius={0}
			style={{
				borderLeft: 'none',
				borderRight: 'none',
				borderTop: 'none',
				padding: '10px 30px',
			}}
		>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: collapsed ? 0 : 8,
				}}
			>
				{/* Status + controls row — kept separate from the track row below so
				    nothing here (the read-only banner appearing/disappearing, hover
				    text changing) ever resizes or shifts the scrubber itself. */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						// Fixed height regardless of whether the banner is rendered, so
						// the track row below never shifts vertically either.
						minHeight: 22,
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							fontSize: 11,
							whiteSpace: 'nowrap',
						}}
					>
						{/* Always in the same spot regardless of collapsed state, so it
						    stays discoverable as the one persistent handle. */}
						<button
							onClick={toggleCollapsed}
							title={collapsed ? 'Show time travel' : 'Hide time travel'}
							style={{
								background: 'transparent',
								border: 'none',
								color: GUI_THEME.dim,
								fontSize: 11,
								padding: 0,
								cursor: 'pointer',
								display: 'flex',
								alignItems: 'center',
								gap: 4,
							}}
						>
							<IconClock size={12} />
							{collapsed ? (
								<IconChevronRight size={12} />
							) : (
								<IconChevronDown size={12} />
							)}
						</button>

						{/* Kept visible even collapsed — the one thing worth surfacing
						    even with the scrubber tucked away is that you're looking
						    at read-only history, not the live board. */}
						{timeTravel.mode === 'scrub' && (
							<>
								<span style={{color: GUI_THEME.accent, fontWeight: 700}}>
									Read-only
								</span>
								<span style={{color: GUI_THEME.primary}}>
									{timeTravel.asOfTime
										? formatDateTime(new Date(timeTravel.asOfTime))
										: ''}
								</span>
							</>
						)}
					</div>

					{!collapsed && (
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 12,
							}}
						>
							<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
								{scope !== 'all' && (
									<div style={{display: 'flex', alignItems: 'center', gap: 4}}>
										<button
											title="Earlier"
											onClick={() => setOffset(o => o + 1)}
											style={navButtonStyle}
										>
											◀
										</button>
										<span
											style={{
												fontSize: 10,
												color: GUI_THEME.dim,
												whiteSpace: 'nowrap',
												overflow: 'hidden',
												// Fixed width (not min) so this label changing text
												// never shifts the buttons around it.
												width: 88,
												flexShrink: 0,
												textAlign: 'center',
											}}
										>
											{formatPeriodLabel(scope, offset, periodRange)}
										</span>
										<button
											title="Later"
											disabled={offset === 0}
											onClick={() => setOffset(o => Math.max(0, o - 1))}
											style={{
												...navButtonStyle,
												opacity: offset === 0 ? 0.35 : 1,
												cursor: offset === 0 ? 'default' : 'pointer',
											}}
										>
											▶
										</button>
									</div>
								)}

								<div style={{display: 'flex', gap: 4}}>
									{(['week', 'month', 'year', 'all'] as const).map(s => (
										<button
											key={s}
											onClick={() => changeScope(s)}
											style={toggleButtonStyle(scope === s)}
										>
											{s === 'all' ? 'All' : s[0]!.toUpperCase() + s.slice(1)}
										</button>
									))}
								</div>
							</div>

							<div style={{display: 'flex', gap: 4}}>
								<button
									title="Every change gets an equal-width frame — no empty gaps for quiet stretches"
									onClick={() => setLayoutMode('even')}
									style={toggleButtonStyle(layoutMode === 'even')}
								>
									Frames
								</button>
								<button
									title="Frames positioned by actual elapsed time"
									onClick={() => setLayoutMode('real')}
									style={toggleButtonStyle(layoutMode === 'real')}
								>
									Time
								</button>
							</div>

							<div
								style={{
									display: 'flex',
									justifyContent: 'flex-end',
									alignItems: 'center',
									// Fixed (not min) width so swapping between "Now" and "Return
									// to live" never resizes the controls row.
									width: 100,
									flexShrink: 0,
								}}
							>
								{timeTravel.mode === 'scrub' ? (
									<button
										onClick={onReturnToLive}
										style={{
											background: 'transparent',
											border: `1px solid ${GUI_THEME.accent}`,
											color: GUI_THEME.accent,
											borderRadius: 6,
											fontSize: 11,
											padding: '2px 8px',
											cursor: 'pointer',
											whiteSpace: 'nowrap',
										}}
									>
										Return to live
									</button>
								) : (
									<span
										style={{
											fontSize: 11,
											color: GUI_THEME.dim,
											overflow: 'hidden',
											textAlign: 'right',
											whiteSpace: 'nowrap',
										}}
									>
										{scope === 'all' || offset === 0
											? 'Now'
											: formatDateTime(new Date(latest))}
									</span>
								)}
							</div>
						</div>
					)}
				</div>

				{!collapsed && (
					<>
						<div
							ref={trackRef}
							onPointerDown={onPointerDown}
							onPointerMove={onPointerMove}
							onPointerUp={endDrag}
							onPointerCancel={endDrag}
							style={{
								position: 'relative',
								width: '100%',
								height: 24,
								cursor: 'pointer',
								display: 'flex',
								alignItems: 'center',
							}}
						>
							{/* Floating hover-hint — left-aligned above the hovered frame,
					    clamped to the track's own bounds so it never overflows
					    left/right. Time always renders as its own first row, so it's
					    in the same place whether hovering the board or code track. */}
							{hoverLabel && (
								<div
									style={{
										position: 'absolute',
										bottom: '100%',
										marginBottom: 4,
										left: hoverHintLeftPx,
										width: HOVER_HINT_WIDTH,
										// Border-box so `width` matches what the clamp math above
										// assumes — otherwise the border/padding add on top of it and
										// the box overflows the track's edge by exactly that much.
										boxSizing: 'border-box',
										display: 'flex',
										flexDirection: 'column',
										gap: 2,
										textAlign: 'left',
										background: GUI_THEME.panel,
										border: `1px solid ${GUI_THEME.line}`,
										borderRadius: 6,
										padding: '6px 10px',
										pointerEvents: 'none',
									}}
								>
									<div
										style={{
											fontSize: 11,
											fontWeight: 600,
											color: GUI_THEME.primary,
											whiteSpace: 'normal',
											wordBreak: 'break-word',
										}}
									>
										{hoverLabel.time}
									</div>
									<div style={{fontSize: 11, color: GUI_THEME.secondary}}>
										{hoverLabel.count} board event
										{hoverLabel.count === 1 ? '' : 's'}
									</div>
								</div>
							)}

							{/* Track line — a floor for the "Frames" stacked-bar look, an axis
					    line running through the middle of the "Timeline" dots. Same
					    treatment (accent color, low opacity) as the code track's own
					    baseline below, so the two read as one paired axis. */}
							<div
								style={{
									position: 'absolute',
									left: 0,
									right: 0,
									...(layoutMode === 'even' ? {bottom: 0} : {}),
									height: 2,
									borderRadius: 999,
									background: GUI_THEME.accent,
									opacity: 0.2,
								}}
							/>

							{/* Frames — one per non-empty bucket, opacity/size scaled by count.
					    "even" lays them out as contiguous equal-width blocks; "real"
					    positions them (as small dots) proportionally to elapsed time. */}
							{frames.map((bucket, index) => {
								const intensity = bucket.count / maxCount;
								const interval = formatInterval(
									bucket.t,
									bucket.t + (timeline?.bucketMs ?? 0),
								);
								const label = `${bucket.count} change${
									bucket.count === 1 ? '' : 's'
								}, ${interval}`;
								const centerFraction =
									layoutMode === 'even'
										? (index + 0.5) / frames.length
										: realFractionForTime(bucket.t);

								const commonProps = {
									title: label,
									onMouseEnter: () => {
										setHoverLabel({time: interval, count: bucket.count});
										setHoveredFrameTime(bucket.t);
										setHoveredFrameFraction(centerFraction);
									},
									onMouseLeave: () => {
										setHoverLabel(null);
										setHoveredFrameTime(null);
										setHoveredFrameFraction(null);
									},
								};

								if (layoutMode === 'even') {
									const widthPercent = 100 / frames.length;

									return (
										// Hit-target spans the full track height, not just the bar's
										// rendered height — a short/low-intensity bar would otherwise
										// need pixel-precise aim to hover. Background tints on hover so
										// the whole column reads as the hit target, not just the bar.
										<div
											key={bucket.t}
											{...commonProps}
											style={{
												position: 'absolute',
												left: `${index * widthPercent}%`,
												top: 0,
												bottom: 0,
												width: `calc(${widthPercent}% - 1px)`,
												background:
													hoveredFrameTime === bucket.t
														? 'rgba(255, 255, 255, 0.06)'
														: 'transparent',
												pointerEvents: 'auto',
											}}
										>
											{/* A synthesized placeholder bucket (see the `frames`
											    comment above) or any other genuinely zero-activity
											    slot renders no bar at all — invisible, not just tiny —
											    while the hit-target div above still covers it, so
											    hovering still surfaces its date and "0 changes". */}
											{bucket.count > 0 && (
												<div
													style={{
														position: 'absolute',
														left: 0,
														right: 0,
														bottom: 0,
														// Bottom-anchored so height reads as a stacked-bar chart
														// — how much happened at that point in time — rather
														// than a centered blip.
														height: 3 + intensity * 21,
														borderRadius: '1px 1px 0 0',
														background: GUI_THEME.accent,
														opacity: 0.35 + intensity * 0.65,
														pointerEvents: 'none',
													}}
												/>
											)}
										</div>
									);
								}

								const fraction = realFractionForTime(bucket.t);

								return (
									<div
										key={bucket.t}
										{...commonProps}
										style={{
											position: 'absolute',
											left: `${fraction * 100}%`,
											width: 4,
											height: 4 + intensity * 10,
											borderRadius: 2,
											background: GUI_THEME.accent,
											opacity: 0.35 + intensity * 0.65,
											transform: 'translateX(-2px)',
											pointerEvents: 'auto',
										}}
									/>
								);
							})}

							{/* Draggable thumb / playhead — a full-height needle in a color
					    distinct from the accent-colored frames so it stays visible
					    against them, with a downward-pointing triangle handle that
					    highlights on hover for grab affordance. */}
							<div
								onMouseEnter={() => setNeedleHovered(true)}
								onMouseLeave={() => setNeedleHovered(false)}
								style={{
									position: 'absolute',
									left: `${thumbFraction * 100}%`,
									top: 0,
									bottom: 0,
									width: 2,
									background: GUI_THEME.primary,
									boxShadow: needleHovered
										? `0 0 10px 2px ${GUI_THEME.primary}`
										: `0 0 6px 1px ${GUI_THEME.primary}`,
									transform: 'translateX(-1px)',
									pointerEvents: 'auto',
									cursor: 'pointer',
								}}
							/>
							<div
								onMouseEnter={() => setNeedleHovered(true)}
								onMouseLeave={() => setNeedleHovered(false)}
								style={{
									position: 'absolute',
									left: `${thumbFraction * 100}%`,
									top: needleHovered ? -9 : -7,
									width: 0,
									height: 0,
									borderLeft: `${needleHovered ? 6 : 5}px solid transparent`,
									borderRight: `${needleHovered ? 6 : 5}px solid transparent`,
									borderTop: `${needleHovered ? 8 : 7}px solid ${
										GUI_THEME.primary
									}`,
									filter: `drop-shadow(0 0 ${needleHovered ? 5 : 3}px ${
										GUI_THEME.primary
									})`,
									transform: `translateX(${needleHovered ? -6 : -5}px)`,
									pointerEvents: 'auto',
									cursor: 'pointer',
								}}
							/>
						</div>

						{/* Code commits — a second, thinner track sharing the same
					    horizontal coordinate space as the track above, so a commit at
					    a given x is the same moment as a frame directly above it. In
					    "Time" mode each commit is its own draggable dot, positioned
					    (and clickable, to inspect its diff) by exact real elapsed
					    time. In "Frames" mode commits snap into the same buckets as
					    the issue frames above and render as one bar per bucket,
					    top-anchored and growing downward — the mirror image of the
					    issue bars' bottom-anchored growth, so the two tracks read as
					    one shape (an "iceberg") expanding away from the shared axis
					    between them in both directions. */}
						{commits.length > 0 && (
							<div
								style={{
									position: 'relative',
									width: '100%',
									// Matches the issue track's own height above, so the two
									// tracks carry equal visual weight — the "iceberg" shape
									// only reads if both halves are comparably sized.
									height: 24,
								}}
							>
								{commitHoverLabel && (
									<div
										style={{
											position: 'absolute',
											bottom: '100%',
											marginBottom: 4,
											left: commitHintLeftPx,
											width: HOVER_HINT_WIDTH,
											boxSizing: 'border-box',
											display: 'flex',
											flexDirection: 'column',
											gap: 2,
											textAlign: 'left',
											background: GUI_THEME.panel,
											border: `1px solid ${GUI_THEME.line}`,
											borderRadius: 6,
											padding: '6px 10px',
											pointerEvents: 'none',
										}}
									>
										<div
											style={{
												fontSize: 11,
												fontWeight: 600,
												color: GUI_THEME.primary,
												whiteSpace: 'normal',
												wordBreak: 'break-word',
											}}
										>
											{commitHoverLabel.time}
										</div>
										{commitHoverLabel.rows.map((row, index) => (
											<div
												key={index}
												style={{
													fontSize: 11,
													color: GUI_THEME.secondary,
													whiteSpace: 'normal',
													wordBreak: 'break-word',
												}}
											>
												{row}
											</div>
										))}
									</div>
								)}

								<div
									style={{
										position: 'absolute',
										left: 0,
										right: 0,
										...(layoutMode === 'even' ? {top: 0} : {top: '50%'}),
										height: 1,
										borderRadius: 999,
										background: GUI_THEME.green,
										opacity: 0.2,
									}}
								/>

								{layoutMode === 'even'
									? frames.map((bucket, index) => {
											const stats = commitStatsByFrameIndex.get(index);
											if (!stats) return null;

											const intensity = stats.count / maxCommitCount;
											const widthPercent = 100 / frames.length;
											const isHovered = hoveredCommitBucket?.index === index;

											return (
												<div
													key={bucket.t}
													onMouseEnter={() =>
														setHoveredCommitBucket({index, ...stats})
													}
													onMouseLeave={() => setHoveredCommitBucket(null)}
													style={{
														position: 'absolute',
														left: `${index * widthPercent}%`,
														top: 0,
														bottom: 0,
														width: `calc(${widthPercent}% - 1px)`,
														background: isHovered
															? 'rgba(255, 255, 255, 0.06)'
															: 'transparent',
														pointerEvents: 'auto',
													}}
												>
													<div
														style={{
															position: 'absolute',
															left: 0,
															right: 0,
															top: 0,
															// Top-anchored so it grows downward, mirroring the
															// issue frame bar's bottom-anchored growth above,
															// using the same count-based intensity formula.
															height: 3 + intensity * 21,
															borderRadius: '0 0 1px 1px',
															background: GUI_THEME.green,
															opacity: 0.35 + intensity * 0.65,
															pointerEvents: 'none',
														}}
													/>
												</div>
											);
									  })
									: commits.map(commit => {
											const fraction = realFractionForTime(commit.time);
											// Uniform size — an individual commit doesn't have a
											// "count" of its own to vary by, unlike the aggregated
											// bucket bars in Frames mode above.
											const size = 6;

											return (
												<div
													key={commit.sha}
													title={`${formatDateTime(new Date(commit.time))} — ${
														commit.subject
													} — ${
														commit.author
													} (${commit.linesChanged.toLocaleString()} lines)`}
													onClick={() => onInspectCommit(commit.sha)}
													onMouseEnter={() => {
														setHoveredCommit(commit);
														setHoveredCommitFraction(fraction);
													}}
													onMouseLeave={() => {
														setHoveredCommit(null);
														setHoveredCommitFraction(null);
													}}
													style={{
														position: 'absolute',
														left: `${fraction * 100}%`,
														top: '50%',
														width: size,
														height: size,
														borderRadius: '50%',
														background: GUI_THEME.green,
														opacity:
															hoveredCommit?.sha === commit.sha ? 1 : 0.65,
														transform: `translate(${-size / 2}px, -50%)`,
														pointerEvents: 'auto',
														cursor: 'pointer',
													}}
												/>
											);
									  })}
							</div>
						)}
					</>
				)}
			</div>
		</Panel>
	);
};
