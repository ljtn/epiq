// Every piece of the time scrubber's markup. Presentational only: props in,
// JSX out, no state but the needle's own hover. TimeScrubber owns the data and
// arranges these; the maths they draw against lives in lib/scrubber.

import {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	barGrowAnimation,
	BAR_ENTRANCE_TOTAL_MS,
	barWidthCss,
	BUCKET_HIGHLIGHT_COLOR,
	clamp,
	EVENTS_MODE_VERTICAL_PADDING,
	EVENTS_SCATTER_HEIGHT,
	FADE_IN_ANIMATION,
	formatPeriodLabel,
	HOVER_HINT_WIDTH,
	LayoutMode,
	NEEDLE_COLOR,
	PeriodRange,
	Scope,
	scopeButtonLabel,
	SCOPES,
	Segment,
	SEGMENT_HIGHLIGHT_COLOR,
	TRACK_HEIGHT,
	VolumeBar,
} from '../lib/scrubber';
import {Checkbox} from './Checkbox';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: `1px solid ${active ? GUI_THEME.accent : GUI_THEME.dim}`,
	color: active ? GUI_THEME.accent : GUI_THEME.dim,
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

export const ScrubberControls = ({
	scope,
	offset,
	periodRange,
	layoutMode,
	showIssues,
	showCommits,
	allBoards,
	isScrubbing,
	nowLabel,
	onChangeScope,
	onChangeOffset,
	onChangeLayoutMode,
	onChangeShowIssues,
	onChangeShowCommits,
	onChangeAllBoards,
	onReturnToLive,
}: {
	scope: Scope;
	offset: number;
	periodRange: PeriodRange | null;
	layoutMode: LayoutMode;
	showIssues: boolean;
	showCommits: boolean;
	allBoards: boolean;
	isScrubbing: boolean;
	// What the live slot reads when not scrubbing: "Now", or the window's end.
	nowLabel: string;
	onChangeScope: (scope: Scope) => void;
	onChangeOffset: (offset: number) => void;
	onChangeLayoutMode: (mode: LayoutMode) => void;
	onChangeShowIssues: (next: boolean) => void;
	onChangeShowCommits: (next: boolean) => void;
	onChangeAllBoards: (next: boolean) => void;
	onReturnToLive: () => void;
}) => (
	<div style={{display: 'flex', alignItems: 'center', gap: 12}}>
		<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
			{scope !== 'all' && (
				<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
					<button
						title="Earlier"
						onClick={() => onChangeOffset(offset + 1)}
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
							// Fixed, not min, so the changing label never shifts the
							// buttons around it.
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
						onClick={() => onChangeOffset(Math.max(0, offset - 1))}
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

			<div style={{display: 'flex', gap: 2}}>
				{SCOPES.map(option => (
					<button
						key={option}
						onClick={() => onChangeScope(option)}
						style={toggleButtonStyle(scope === option)}
					>
						{scopeButtonLabel(option)}
					</button>
				))}
			</div>
		</div>

		<div style={{display: 'flex', gap: 2}}>
			<button
				title="How much happened, per equal-width period — no empty gaps for quiet stretches"
				onClick={() => onChangeLayoutMode('even')}
				style={toggleButtonStyle(layoutMode === 'even')}
			>
				Volume
			</button>
			<button
				title="Individual events by exact moment — x is elapsed time, y is time of day"
				onClick={() => onChangeLayoutMode('real')}
				style={toggleButtonStyle(layoutMode === 'real')}
			>
				Events
			</button>
		</div>

		<div style={{display: 'flex', gap: 10}}>
			<Checkbox
				label="Board"
				checked={showIssues}
				activeColor={GUI_THEME.accent}
				onChange={onChangeShowIssues}
			/>
			<Checkbox
				label="Code"
				checked={showCommits}
				activeColor={GUI_THEME.green}
				onChange={onChangeShowCommits}
			/>
			<Checkbox
				label="All boards"
				checked={allBoards}
				activeColor={GUI_THEME.accent}
				onChange={onChangeAllBoards}
			/>
		</div>

		<div
			style={{
				display: 'flex',
				justifyContent: 'flex-end',
				alignItems: 'center',
				// Fixed, not min, so swapping between "Now" and "Return to live"
				// never resizes the controls row.
				width: 100,
				flexShrink: 0,
			}}
		>
			{isScrubbing ? (
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
					{nowLabel}
				</span>
			)}
		</div>
	</div>
);

// The collapse toggle, plus the read-only banner that stays visible while
// collapsed: that the board is read-only history must never be hidden.
export const ScrubberHeader = ({
	collapsed,
	onToggleCollapsed,
	scrubbingAsOf,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
	// Null while live.
	scrubbingAsOf: string | null;
}) => (
	<div
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			fontSize: 11,
			whiteSpace: 'nowrap',
		}}
	>
		<button
			onClick={onToggleCollapsed}
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
			{'Time travel'}
			{collapsed ? (
				<IconChevronRight size={12} />
			) : (
				<IconChevronDown size={12} />
			)}
		</button>

		{scrubbingAsOf !== null && (
			<>
				<span style={{color: GUI_THEME.accent, fontWeight: 700}}>
					Read-only
				</span>
				<span style={{color: GUI_THEME.primary}}>{scrubbingAsOf}</span>
			</>
		)}
	</div>
);

// Deliberately one block spanning both charts and the gap: hovering a commit
// lights up the same day in the issue track above, which is what makes the two
// halves read as one time grid.
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
				display: 'flex',
				justifyContent: 'center',
				paddingTop: 3,
				// With top and bottom both pinned, content-box would add the padding
				// on top of the resolved height and push the block past the wrapper
				// it spans.
				boxSizing: 'border-box',
				fontSize: 9,
				color: GUI_THEME.dim2,
				whiteSpace: 'nowrap',
				// The label is wider than its block at month and year scopes; only
				// one segment is ever highlighted, so it has nothing to overlap.
				overflow: 'visible',
			}}
		>
			{segment.label}
		</div>
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
			opacity: 0.2,
		}}
	/>
);

// Absolute positioning ignores the track's padding, so top and bottom add it
// back to line up with the points.
export const HourAxisLabels = () => (
	<>
		{(
			[
				['00:00', {top: EVENTS_MODE_VERTICAL_PADDING}],
				['12:00', {top: '50%', transform: 'translateY(-50%)'}],
				['24:00', {bottom: EVENTS_MODE_VERTICAL_PADDING}],
			] as const
		).map(([label, position]) => (
			<span
				key={label}
				style={{
					position: 'absolute',
					left: 2,
					fontSize: 9,
					color: GUI_THEME.dim,
					pointerEvents: 'none',
					...position,
				}}
			>
				{label}
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
		}}
	>
		{children}
	</div>
);

// Shared by the issue histogram and the commit one mirrored below it, so the
// two halves cannot drift apart. Empty buckets draw nothing and stay hoverable
// anyway, since hover is resolved arithmetically rather than by hit target.
export const VolumeBars = ({
	bars,
	bucketCount,
	firstBar,
	lastBar,
	highlightedIndex,
	color,
	direction,
	animate,
}: {
	bars: VolumeBar[];
	bucketCount: number;
	// The populated span, so the growth sweep runs across drawn bars only.
	firstBar: number;
	lastBar: number;
	highlightedIndex: number | null;
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
			{/* Spans the full track height rather than the bar's, so empty buckets
			    highlight too. */}
			{highlightedIndex !== null && (
				<div
					style={{
						position: 'absolute',
						left: `${highlightedIndex * widthPercent}%`,
						top: 0,
						bottom: 0,
						width: `${widthPercent}%`,
						// A bucket can be thinner than a pixel at wide spans.
						minWidth: 2,
						background: BUCKET_HIGHLIGHT_COLOR,
						pointerEvents: 'none',
					}}
				/>
			)}

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

// Shared by both scatter series for the same reason. The vertical padding has
// to be added back by hand: absolute positioning ignores the track's own.
export const ScatterDot = ({
	fraction,
	hourFraction,
	size,
	color,
	opacity,
	zIndex,
	title,
	animation,
	interactive = true,
	onMouseEnter,
	onMouseLeave,
	onClick,
}: {
	// x is elapsed time across the window, y is time of day.
	fraction: number;
	hourFraction: number;
	size: number;
	color: string;
	// Capped below 1 by callers so overlapping points blend rather than one
	// hiding another.
	opacity: number;
	zIndex: number;
	title: string;
	animation: string | undefined;
	// False while the series retracts, so a dot on its way out cannot be
	// hovered for a hint or clicked into a diff.
	interactive?: boolean;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
	onClick?: () => void;
}) => (
	<div
		title={title}
		// Without stopping it here, clicking a dot to inspect its diff would also
		// start a scrub-drag on the track underneath.
		onPointerDown={onClick && (event => event.stopPropagation())}
		onClick={
			onClick &&
			(event => {
				event.stopPropagation();
				onClick();
			})
		}
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		style={{
			position: 'absolute',
			left: `${fraction * 100}%`,
			top: EVENTS_MODE_VERTICAL_PADDING + hourFraction * EVENTS_SCATTER_HEIGHT,
			width: size,
			height: size,
			borderRadius: '50%',
			background: color,
			opacity,
			zIndex,
			transform: `translate(${-size / 2}px, -50%)`,
			animation,
			pointerEvents: interactive ? 'auto' : 'none',
			cursor: onClick ? 'pointer' : undefined,
		}}
	/>
);

// Lives on the chart wrapper rather than inside either chart, so it runs
// unbroken through both and the gap between them.
export const ScrubberNeedle = ({fraction}: {fraction: number}) => {
	const [hovered, setHovered] = useState(false);

	const hover = {
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
	};

	return (
		<>
			<div
				{...hover}
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: 0,
					bottom: 0,
					// A hairline, no glow: the needle marks an exact instant, and a
					// soft edge blooms over bars that can be ~2px wide.
					width: 1,
					background: NEEDLE_COLOR,
					zIndex: 3,
					transform: 'translateX(-0.5px)',
					pointerEvents: 'auto',
					cursor: 'pointer',
				}}
			/>
			<div
				{...hover}
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: hovered ? -9 : -7,
					width: 0,
					height: 0,
					borderLeft: `${hovered ? 6 : 5}px solid transparent`,
					borderRight: `${hovered ? 6 : 5}px solid transparent`,
					borderTop: `${hovered ? 8 : 7}px solid ${NEEDLE_COLOR}`,
					zIndex: 3,
					transform: `translateX(${hovered ? -6 : -5}px)`,
					pointerEvents: 'auto',
					cursor: 'pointer',
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
}: {
	label: string;
	rows: string[];
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
