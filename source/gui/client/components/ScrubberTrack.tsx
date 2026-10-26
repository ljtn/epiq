// The chart's parts: baseline, highlight, bars, needle and hint.
// Presentational; the maths is in lib/scrubber.

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
	UNAPPLIED_EDGE_COLOR,
	UNAPPLIED_VEIL_COLOR,
	UNAPPLIED_VEIL_IMAGE,
	NEEDLE_GRIP_WIDTH,
	RANGE_SELECTION_COLOR,
	RANGE_SELECTION_EDGE,
	Segment,
	SegmentBoundary,
	SEGMENT_BOUNDARY_COLOR,
	SEGMENT_HIGHLIGHT_COLOR,
	SEGMENT_LABEL_COLOR,
	stackedBarShape,
	TRACK_HEIGHT,
	VolumeBar,
} from '../lib/scrubber';

// A hairline and short label at every segment boundary, across both charts.
export const SegmentBoundaries = ({
	boundaries,
	hovered,
	fractionForTime,
}: {
	boundaries: readonly SegmentBoundary[];
	// The segment under the pointer, whose short label gives way to the highlight's name.
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
			{/* The full name takes the short label's place and size. */}
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

// The range drag so far, across both charts and the gap.
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

// A chart-edge label on a dark pane, readable over bands and lines.
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

// Each strand's name, beside it.
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

// Carries the entrance fade: bars are keyed by bucket and would flash on remount.
// Callers key it per series, since the layers are siblings.
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
			// Contains layout so a drag above doesn't re-lay-out the dots.
			contain: 'layout paint',
		}}
	>
		{children}
	</div>
);

// Shared by both histograms. Full track height so empty buckets highlight too;
// a sibling of the bars so they don't re-render on mouse move.
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
	testId,
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
	testId?: string;
}) => {
	const widthPercent = 100 / bucketCount;
	const barWidth = barWidthCss(bucketCount);
	const growsUp = direction === 'up';

	// Only bars present at mount animate in.
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
					data-testid={testId}
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

// Removed and added lines stacked from the commit bars' edge: length is churn,
// colour the split, removals against the baseline.
const StackedVolumeBarsImpl = ({
	segments,
	bucketCount,
	firstBar,
	lastBar,
	colors,
	animate,
}: {
	// One entry per bucket, each half already a fraction of the track.
	segments: {index: number; top: number; bottom: number}[];
	bucketCount: number;
	firstBar: number;
	lastBar: number;
	colors: {top: string; bottom: string};
	animate: boolean;
}) => {
	const widthPercent = 100 / bucketCount;
	const barWidth = barWidthCss(bucketCount);
	const [fresh, setFresh] = useState(true);

	useEffect(() => {
		const timeout = setTimeout(() => setFresh(false), BAR_ENTRANCE_TOTAL_MS);
		return () => clearTimeout(timeout);
	}, []);

	return (
		<>
			{segments.map(({index, top, bottom}) => {
				const size = top + bottom;
				const {height, share} = stackedBarShape(top, bottom, TRACK_HEIGHT);

				return (
					<div
						key={index}
						data-testid="line-bar"
						data-share={share.toFixed(3)}
						style={{
							position: 'absolute',
							left: `${index * widthPercent}%`,
							top: 0,
							width: barWidth,
							height,
							display: 'flex',
							flexDirection: 'column',
							borderRadius: '0 0 1px 1px',
							overflow: 'hidden',
							opacity: 0.35 + Math.min(1, size) * 0.65,
							transformOrigin: 'top',
							animation:
								animate && fresh
									? barGrowAnimation(index, firstBar, lastBar)
									: undefined,
							pointerEvents: 'none',
						}}
					>
						<div style={{height: `${share * 100}%`, background: colors.top}} />
						<div style={{flex: 1, background: colors.bottom}} />
					</div>
				);
			})}
		</>
	);
};

export const StackedVolumeBars = memo(StackedVolumeBarsImpl);

// Lives on the chart wrapper rather than inside either chart, so it runs
// unbroken through both and the gap between them.
/**
 * The unapplied stretch, from the needle (or the left edge, when a zoom puts
 * the needle off-chart) to the window's end. Inert, over the bars.
 */
export const UnappliedStretch = ({from}: {from: number}) => (
	<div
		data-testid="scrubber-unapplied"
		style={{
			position: 'absolute',
			left: `${from * 100}%`,
			right: 0,
			top: 0,
			bottom: 0,
			backgroundColor: UNAPPLIED_VEIL_COLOR,
			backgroundImage: UNAPPLIED_VEIL_IMAGE,
			// Edge only where the needle is in view.
			borderLeft: from > 0 ? `1px solid ${UNAPPLIED_EDGE_COLOR}` : undefined,
			zIndex: 2,
			pointerEvents: 'none',
		}}
	/>
);

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
					// A hairline live. Two pixels parked, so it shares the head's whole-pixel grid.
					width: parked ? 2 : 1,
					background: color,
					boxShadow: parked ? NEEDLE_PARKED_GLOW : undefined,
					zIndex: 3,
					transform: `translateX(${parked ? -1 : -0.5}px)`,
					pointerEvents: 'none',
				}}
			/>
			<div
				{...grip}
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					// One pixel low, so the triangle's faint tip overlaps the line.
					top: hovered ? -8 : -6,
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
