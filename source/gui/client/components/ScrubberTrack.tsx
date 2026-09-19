// The chart itself, in parts: the baseline, what is highlighted on it, the
// bars and the needle, and the hint that follows the pointer. Presentational
// only, no state but the needle's own hover; the maths they draw against
// lives in lib/scrubber.

import {memo, useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	barGrowAnimation,
	BAR_ENTRANCE_TOTAL_MS,
	barWidthCss,
	BUCKET_HIGHLIGHT_COLOR,
	clamp,
	EVENTS_MODE_VERTICAL_PADDING,
	FlowGeometry,
	FlowStrand,
	flowStrandCentre,
	FADE_IN_ANIMATION,
	HOVER_HINT_WIDTH,
	NEEDLE_COLOR,
	NEEDLE_PARKED_COLOR,
	NEEDLE_PARKED_GLOW,
	UNAPPLIED_VEIL_COLOR,
	NEEDLE_GRIP_WIDTH,
	RANGE_SELECTION_COLOR,
	RANGE_SELECTION_EDGE,
	Segment,
	SegmentBoundary,
	SEGMENT_BOUNDARY_COLOR,
	SEGMENT_HIGHLIGHT_COLOR,
	SEGMENT_LABEL_COLOR,
	TRACK_HEIGHT,
	VolumeBar,
} from '../lib/scrubber';

// The track's grain: a hairline at every segment boundary, spanning both
// charts and the gap like the highlight does, with the shortest label of the
// segment that starts there tucked against it, so the hour, day or week the
// window is cut into can be read without the pointer. The highlight sits over
// them and spells out the one under the pointer.
export const SegmentBoundaries = ({
	boundaries,
	hovered,
	fractionForTime,
}: {
	boundaries: readonly SegmentBoundary[];
	// The grain segment under the pointer: the highlight's full name stands
	// in for its short label, which would otherwise sit beside or under the
	// name and collide with it.
	hovered: Segment | null;
	fractionForTime: (time: number) => number;
}) => (
	<>
		{boundaries.map(({time, label}) => (
			<div
				key={time}
				data-testid="segment-boundary"
				aria-hidden
				style={{
					position: 'absolute',
					left: `${fractionForTime(time) * 100}%`,
					top: 0,
					bottom: 0,
					width: 1,
					background: SEGMENT_BOUNDARY_COLOR,
					pointerEvents: 'none',
				}}
			>
				{label !== null &&
					!(hovered && time >= hovered.start && time < hovered.end) && (
						<span
							style={{
								position: 'absolute',
								top: 1,
								left: 3,
								fontSize: 8,
								lineHeight: 1,
								color: SEGMENT_LABEL_COLOR,
								whiteSpace: 'nowrap',
							}}
						>
							{label}
						</span>
					)}
			</div>
		))}
	</>
);

export const SegmentHighlight = ({
	segment,
	fractionForTime,
}: {
	segment: Segment;
	fractionForTime: (time: number) => number;
}) => {
	const left = fractionForTime(segment.start);

	return (
		<div
			style={{
				position: 'absolute',
				left: `${left * 100}%`,
				width: `${(fractionForTime(segment.end) - left) * 100}%`,
				top: 0,
				bottom: 0,
				background: SEGMENT_HIGHLIGHT_COLOR,
				pointerEvents: 'none',
				// The label is wider than its block at month and year scopes; only
				// one segment is ever highlighted, so it has nothing to overlap.
				overflow: 'visible',
			}}
		>
			{/* Exactly where the boundary's short label sits, in its size: the
			    full name takes the short one's place rather than floating over
			    the block. */}
			<span
				style={{
					position: 'absolute',
					top: 1,
					left: 3,
					fontSize: 8,
					lineHeight: 1,
					color: GUI_THEME.dim2,
					whiteSpace: 'nowrap',
				}}
			>
				{segment.label}
			</span>
		</div>
	);
};

// The stretch a range drag has covered so far. Spans both charts and the gap,
// like the segment highlight, because the window it will zoom to is one window
// over both series.
export const RangeSelection = ({from, to}: {from: number; to: number}) => {
	const left = Math.min(from, to);

	return (
		<div
			data-testid="scrubber-range-selection"
			style={{
				position: 'absolute',
				left: `${left * 100}%`,
				width: `${Math.abs(to - from) * 100}%`,
				top: 0,
				bottom: 0,
				background: RANGE_SELECTION_COLOR,
				borderLeft: `1px solid ${RANGE_SELECTION_EDGE}`,
				borderRight: `1px solid ${RANGE_SELECTION_EDGE}`,
				boxSizing: 'border-box',
				pointerEvents: 'none',
				// Over the needle: the needle marks where the board is, the selection
				// what is about to replace the whole window.
				zIndex: 4,
			}}
		/>
	);
};

// The baseline every series is drawn against.
export const TrackBaseline = ({
	color,
	anchor,
}: {
	color: string;
	anchor: 'centre' | 'bottom' | 'top';
}) => (
	<div
		style={{
			position: 'absolute',
			left: 0,
			right: 0,
			...(anchor === 'bottom' ? {bottom: 0} : {}),
			...(anchor === 'top' ? {top: 0} : {}),
			height: anchor === 'top' ? 1 : 2,
			borderRadius: 999,
			background: color,
			// The centre line runs through the scatter's dots, so it sits a shade
			// fainter than the edge-anchored baselines.
			opacity: anchor === 'centre' ? 0.14 : 0.2,
		}}
	/>
);

// Absolute positioning ignores the track's padding, so top and bottom add it
// back to line up with the points.
// A label beside the chart's edge, on a darkened pane over whatever is drawn
// under it, so it stays readable when a full band or a lit line runs there.
const chartLabelStyle: React.CSSProperties = {
	position: 'absolute',
	left: 2,
	fontSize: 9,
	lineHeight: 1,
	color: GUI_THEME.secondary,
	padding: '2px 4px',
	borderRadius: 2,
	background: 'rgba(0, 0, 0, 0.55)',
	pointerEvents: 'none',
};

export const HourAxisLabels = () => (
	<>
		{(
			[
				['00:00', {top: EVENTS_MODE_VERTICAL_PADDING - 2}],
				['12:00', {top: '50%', transform: 'translateY(-50%)'}],
				['24:00', {bottom: EVENTS_MODE_VERTICAL_PADDING - 2}],
			] as const
		).map(([label, position]) => (
			<span key={label} style={{...chartLabelStyle, ...position}}>
				{label}
			</span>
		))}
	</>
);

// The strands' names, one beside each, the way the hour labels sit beside the
// scatter. Kept short: the chart is the width of the board and the lines run
// under these from the left edge.
export const FlowStrandLabels = ({
	strands,
	geometry,
}: {
	strands: readonly FlowStrand[];
	geometry: FlowGeometry;
}) => (
	<>
		{strands.map((strand, index) => (
			<span
				key={strand.id}
				style={{
					...chartLabelStyle,
					top: flowStrandCentre(geometry, index),
					transform: 'translateY(-50%)',
					maxWidth: 150,
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{strand.title}
			</span>
		))}
	</>
);

// The wrapper the entrance fade belongs on, never the individual bars or dots:
// those are keyed by bucket time, so a scope change remounts each one and the
// fade restarts per element as a full-chart flash. Callers key it per series —
// the issue and commit layers are siblings, so a shared key collides and leaves
// stale marks on screen.
export const SeriesLayer = ({
	animate,
	children,
}: {
	animate: boolean;
	children: React.ReactNode;
}) => (
	<div
		style={{
			position: 'absolute',
			inset: 0,
			pointerEvents: 'none',
			animation: animate ? FADE_IN_ANIMATION : undefined,
			// Walls this subtree off from the needle and highlight moving above
			// it: without containment every frame of a drag re-lays-out the
			// thousands of dots inside, and the drag stutters.
			contain: 'layout paint',
		}}
	>
		{children}
	</div>
);

// Shared by the issue histogram and the commit one mirrored below it, so the
// two halves cannot drift apart. Empty buckets draw nothing and stay hoverable
// anyway, since hover is resolved arithmetically rather than by hit target.
// Spans the full track height rather than the bar's, so empty buckets highlight
// too. A sibling of the bars rather than one of them: it moves on every mouse
// move, and the bars — up to MAX_TIME_BUCKETS nodes — must not re-render with
// it.
export const BucketHighlight = ({
	index,
	bucketCount,
}: {
	index: number;
	bucketCount: number;
}) => (
	<div
		style={{
			position: 'absolute',
			left: `${index * (100 / bucketCount)}%`,
			top: 0,
			bottom: 0,
			width: `${100 / bucketCount}%`,
			// A bucket can be thinner than a pixel at wide spans.
			minWidth: 2,
			background: BUCKET_HIGHLIGHT_COLOR,
			pointerEvents: 'none',
		}}
	/>
);

const VolumeBarsImpl = ({
	bars,
	bucketCount,
	firstBar,
	lastBar,
	color,
	direction,
	animate,
}: {
	bars: VolumeBar[];
	bucketCount: number;
	// The populated span, so the growth sweep runs across drawn bars only.
	firstBar: number;
	lastBar: number;
	color: string;
	// "up" is the issue histogram, "down" the mirrored commit one.
	direction: 'up' | 'down';
	animate: boolean;
}) => {
	const widthPercent = 100 / bucketCount;
	const barWidth = barWidthCss(bucketCount);
	const growsUp = direction === 'up';

	// Only the bars present when this layer mounted are part of the entrance.
	// A bar that appears later belongs to data arriving on its own, and must
	// take its place without announcing itself.
	const [fresh, setFresh] = useState(true);

	useEffect(() => {
		const timeout = setTimeout(() => setFresh(false), BAR_ENTRANCE_TOTAL_MS);
		return () => clearTimeout(timeout);
	}, []);

	return (
		<>
			{bars.map(({index, intensity}) => (
				<div
					key={index}
					style={{
						position: 'absolute',
						left: `${index * widthPercent}%`,
						...(growsUp ? {bottom: 0} : {top: 0}),
						width: barWidth,
						height: 3 + intensity * (TRACK_HEIGHT - 3),
						borderRadius: growsUp ? '1px 1px 0 0' : '0 0 1px 1px',
						background: color,
						opacity: 0.35 + intensity * 0.65,
						transformOrigin: growsUp ? 'bottom' : 'top',
						animation:
							animate && fresh
								? barGrowAnimation(index, firstBar, lastBar)
								: undefined,
						pointerEvents: 'none',
					}}
				/>
			))}
		</>
	);
};

// Memoized because the track re-renders on every mouse move while the bars
// themselves change only when the window or the filter does.
export const VolumeBars = memo(VolumeBarsImpl);

// Lives on the chart wrapper rather than inside either chart, so it runs
// unbroken through both and the gap between them.
export const ScrubberNeedle = ({
	fraction,
	parked,
	onGrab,
}: {
	fraction: number;
	// The board is standing where this needle is, rather than at the present.
	// Louder then, and the stretch it has not applied is veiled behind it.
	parked: boolean;
	// A press here is a scrub, not the start of a range drag. The event still
	// bubbles to the track, which owns the pointer capture and the moving.
	onGrab: () => void;
}) => {
	const [hovered, setHovered] = useState(false);
	const color = parked ? NEEDLE_PARKED_COLOR : NEEDLE_COLOR;

	const grip = {
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
		onPointerDown: onGrab,
	};

	return (
		<>
			{/* What the board has not applied, from the needle to the end of the
			    window. Over the bars rather than instead of them: the shape of the
			    history stays readable through it, and the stretch reads as "not
			    yet" rather than as missing. Under the needle's own z-index, and
			    inert — the track beneath it is still where a scrub is aimed. */}
			{parked && (
				<div
					data-testid="scrubber-unapplied"
					style={{
						position: 'absolute',
						left: `${fraction * 100}%`,
						right: 0,
						top: 0,
						bottom: 0,
						background: UNAPPLIED_VEIL_COLOR,
						zIndex: 2,
						pointerEvents: 'none',
					}}
				/>
			)}

			{/* A hairline is a 1px drag target. This is the same line's worth of
			    grabbable width, invisible, centred on it. */}
			<div
				{...grip}
				data-testid="scrubber-needle-grip"
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: 0,
					bottom: 0,
					width: NEEDLE_GRIP_WIDTH,
					transform: `translateX(${-NEEDLE_GRIP_WIDTH / 2}px)`,
					zIndex: 3,
					pointerEvents: 'auto',
					cursor: 'ew-resize',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: 0,
					bottom: 0,
					// A hairline, no glow: the needle marks an exact instant, and a
					// soft edge blooms over bars that can be ~2px wide.
					width: 1,
					background: color,
					boxShadow: parked ? NEEDLE_PARKED_GLOW : undefined,
					zIndex: 3,
					transform: 'translateX(-0.5px)',
					pointerEvents: 'none',
				}}
			/>
			<div
				{...grip}
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: hovered ? -9 : -7,
					width: 0,
					height: 0,
					borderLeft: `${hovered ? 6 : 5}px solid transparent`,
					borderRight: `${hovered ? 6 : 5}px solid transparent`,
					borderTop: `${hovered ? 8 : 7}px solid ${color}`,
					zIndex: 3,
					transform: `translateX(${hovered ? -6 : -5}px)`,
					pointerEvents: 'auto',
					cursor: 'ew-resize',
				}}
			/>
		</>
	);
};

// Hints hang below the charts; floating above covers the scope/mode controls,
// which is the context being read while pointing at something.
export const ScrubberHoverHint = ({
	label,
	rows,
	segmentLabel,
	stripeColor,
	fraction,
	trackWidthPx,
	empty = false,
	testId,
}: {
	label: string;
	rows: string[];
	testId?: string;
	// Drawn above the hint's own label, so the hovered moment names its period.
	segmentLabel: string | undefined;
	stripeColor: string;
	// Fraction of the track the hint points at, and the track's measured width.
	fraction: number;
	trackWidthPx: number;
	// An interval containing nothing. Still shown, but a shade down.
	empty?: boolean;
}) => (
	<div
		data-testid={testId}
		style={{
			position: 'absolute',
			top: '100%',
			marginTop: 6,
			left: clamp(
				fraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
				0,
				Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			),
			width: HOVER_HINT_WIDTH,
			// Border-box so `width` matches what the clamp math assumes; otherwise
			// border and padding push the box past the track's edge.
			boxSizing: 'border-box',
			display: 'flex',
			flexDirection: 'column',
			gap: 2,
			textAlign: 'left',
			background: GUI_THEME.panel,
			border: `1px solid ${GUI_THEME.line}`,
			borderLeft: `3px solid ${empty ? GUI_THEME.dim : stripeColor}`,
			// Smaller than the 6px used elsewhere: a rounder corner clips the 3px
			// stripe into a visible wedge.
			borderRadius: 3,
			padding: '6px 10px',
			pointerEvents: 'none',
			// Above the board content this overhangs.
			zIndex: 5,
		}}
	>
		{segmentLabel && (
			<div style={{fontSize: 10, color: GUI_THEME.dim}}>{segmentLabel}</div>
		)}
		<div
			style={{
				fontSize: 11,
				fontWeight: 600,
				color: empty ? GUI_THEME.secondary : GUI_THEME.primary,
				whiteSpace: 'normal',
				wordBreak: 'break-word',
			}}
		>
			{label}
		</div>
		{rows.map((row, index) => (
			<div
				key={index}
				style={{
					fontSize: 11,
					color: empty ? GUI_THEME.dim : GUI_THEME.secondary,
					whiteSpace: 'normal',
					wordBreak: 'break-word',
				}}
			>
				{row}
			</div>
		))}
	</div>
);
