// The scrubber's markup entry point: how the header, controls, charts, needle
// and hints are arranged. The pieces it places come from ScrubberParts, the
// numbers it places them at from TimeScrubber, which owns all the logic.

import {memo} from 'react';
import {GuiCommitEntry} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {
	dotAppearAnimation,
	dotDetail,
	dotExitAnimation,
	EVENTS_MODE_VERTICAL_PADDING,
	EVENTS_SCATTER_HEIGHT,
	EventDot,
	FADE_IN_ANIMATION,
	hourFractionForTime,
	LayoutMode,
	ScrubberAxis,
	SCOPED_OUTLINE_COLOR,
	SCRUBBER_KEYFRAMES,
	Segment,
	SeriesPresence,
	TRACK_HEIGHT,
	TRACK_HIT_PADDING,
	VolumeBar,
} from '../lib/scrubber';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {
	BucketHighlight,
	HourAxisLabels,
	RangeSelection,
	ScatterCanvas,
	ScatterLayer,
	ScatterPoint,
	ScrubberControls,
	ScrubberHeader,
	ScrubberHoverHint,
	ScrubberNeedle,
	ScrubberPlayButton,
	SCOPE_ONLY_LABEL,
	SegmentHighlight,
	SeriesLayer,
	TrackBaseline,
	VolumeBars,
} from './ScrubberParts';
import {Panel} from './Panel';
import {Checkbox} from './Checkbox';

const DAY_MS = 24 * 60 * 60 * 1000;

const dotAnimation = (key: string, animate: boolean, leaving: boolean) =>
	!animate
		? undefined
		: leaving
		? dotExitAnimation(key)
		: dotAppearAnimation(key);

export type HintContent = {
	label: string;
	rows: string[];
	fraction: number;
	empty?: boolean;
};

export type ScrubberChartHandlers = {
	onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	onPointerEnd: () => void;
	onGrabNeedle: () => void;
	onTrackMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
	onTrackMouseLeave: () => void;
	onCommitTrackMouseEnter: () => void;
	onCommitTrackMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
	onCommitTrackMouseLeave: () => void;
	onScatterPointEnter: (point: ScatterPoint) => void;
	onScatterPointLeave: () => void;
	onPressCommit: (sha: string | null) => void;
};

export type ScrubberChart = {
	trackRef: React.RefObject<HTMLDivElement | null>;
	axis: ScrubberAxis;
	layoutMode: LayoutMode;
	animate: boolean;
	// Bumped on user-driven view changes only, to replay the entrance animation.
	windowKey: string;
	// Volume mode hides instantly; the scatter series get an exit instead, so
	// they carry a presence rather than a bare flag.
	showIssues: boolean;
	showCommits: boolean;
	issueScatter: SeriesPresence;
	commitScatter: SeriesPresence;
	issueBars: VolumeBar[];
	issueBarRange: [number, number];
	commitBars: VolumeBar[];
	commitBarRange: [number, number];
	// One entry per series, each animating in and out on its own.
	scatterLayers: ScatterLayer[];
	// The Board series' colour under the current view, so the bars and the
	// baseline say the same thing the scatter's dots do.
	issueSeriesColor: string;
	// Dots stop being hover targets mid-drag. Sweeping the needle across the
	// track otherwise crosses hundreds of them, and each enter and leave sets
	// state — 1.5s of blocking over a three-second drag.
	dragging: boolean;
	// The stretch a range drag has covered so far, in track fractions, or null
	// when no range is being dragged out.
	rangeSelection: {from: number; to: number} | null;
	commits: GuiCommitEntry[];
	hoveredCommitSha: string | null;
	hoveredBucketIndex: number | null;
	hoveredCommitBucketIndex: number | null;
	hoveredSegment: Segment | null;
	// Nothing can be asked for with the socket down.
	connected: boolean;
	// The board below is narrowed to this window, so the timeline is not only a
	// picture of it but the control hiding the tickets that are missing.
	scoped: boolean;
	// Null when the moment it marks is outside the window, which is drawn as no
	// needle at all rather than one clamped to an edge it is not at.
	thumbFraction: number | null;
	// The one event singled out by a hovered Log row, or null.
	highlightEventId: string | null;
	trackWidthPx: number;
	boardHint: HintContent | null;
	commitHint: HintContent | null;
	on: ScrubberChartHandlers;
};

export const ScrubberLayout = ({
	collapsed,
	onToggleCollapsed,
	canPlay,
	playTitle,
	onPlay,
	logOpen,
	onChangeLogOpen,
	standDown,
	controls,
	chart,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
	canPlay: boolean;
	playTitle: string;
	onPlay: () => void;
	// The event log panel, switched here and from the player's own pop-out.
	logOpen: boolean;
	onChangeLogOpen: (next: boolean) => void;
	// The history player is up and owns the board's position. Nothing on the bar
	// answers a pointer while it is, but only the controls dim for it: the charts
	// are part of what is being watched — the needle sweeps them as the movie
	// runs — so they stay lit.
	standDown: boolean;
	// The transport is not the caller's to pass: this component decides where it
	// goes, which differs between the open row and the collapsed one.
	controls: Omit<
		React.ComponentProps<typeof ScrubberControls>,
		'canPlay' | 'playTitle' | 'onPlay'
	>;
	chart: ScrubberChart;
}) => {
	const {axis, layoutMode, animate, windowKey, on} = chart;

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
				// Panel clips children to keep its glow inside its rounded corners,
				// which would lop off the overhanging hint. Safe to disable only
				// because this panel is square.
				overflow: 'visible',
				pointerEvents: standDown ? 'none' : undefined,
			}}
		>
			<style>{SCRUBBER_KEYFRAMES}</style>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: collapsed ? 0 : TRACK_HIT_PADDING,
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						// Holds the row's height when collapsing takes the controls out
						// of it.
						minHeight: 22,
						opacity: standDown ? 0.3 : 1,
						transition: 'opacity 240ms ease',
					}}
				>
					<ScrubberHeader
						collapsed={collapsed}
						onToggleCollapsed={onToggleCollapsed}
						logOpen={logOpen}
						onChangeLogOpen={onChangeLogOpen}
					/>

					{collapsed ? (
						// What outlives the charts comes up here rather than going out of
						// reach with them: the transport, which plays the window rather
						// than drawing it, and the narrowing — a link can arrive with the
						// scrubber shut, and collapsing it is remembered, so the board
						// must not be left hiding tickets behind a control nobody can
						// see.
						<div style={{display: 'flex', alignItems: 'center', gap: 12}}>
							{controls.windowOnly && (
								<Checkbox
									label={SCOPE_ONLY_LABEL}
									title="Show every ticket again"
									checked
									onChange={controls.onChangeWindowOnly}
								/>
							)}

							<ScrubberPlayButton
								canPlay={canPlay}
								playTitle={playTitle}
								onPlay={onPlay}
							/>
						</div>
					) : (
						<ScrubberControls
							{...controls}
							canPlay={canPlay}
							playTitle={playTitle}
							onPlay={onPlay}
						/>
					)}
				</div>

				{!collapsed && (
					// Wraps both charts so the period highlight can be one tall block
					// spanning them and the gap between. Pointer handlers belong here
					// rather than on either chart, so a drag or hover anywhere across
					// the pair — the gap included — counts as one timeline.
					<div
						data-testid="scrubber-track"
						onPointerDown={on.onPointerDown}
						onPointerMove={on.onPointerMove}
						onPointerUp={on.onPointerEnd}
						onPointerCancel={on.onPointerEnd}
						onMouseMove={on.onTrackMouseMove}
						onMouseLeave={on.onTrackMouseLeave}
						style={{
							position: 'relative',
							display: 'flex',
							flexDirection: 'column',
							gap: 8,
							// Crosshair, not a hand: a press picks a moment but a drag picks
							// out a range, and the pointer has to say the second is on offer.
							cursor: chart.connected ? 'crosshair' : 'default',
							// Outline rather than a border: it takes up no space, so
							// narrowing the board cannot reflow the charts under the
							// pointer that just clicked.
							outline: chart.scoped
								? `1px solid ${SCOPED_OUTLINE_COLOR}`
								: undefined,
							outlineOffset: 5,
							borderRadius: 4,
							// A drag must never turn into a native text selection or a drag
							// of the axis labels underneath the pointer.
							userSelect: 'none',
							WebkitUserSelect: 'none',
						}}
					>
						{/* The gap above the charts, made part of the track for the
					    pointer and nothing else. Absolutely positioned so it draws
					    nothing, takes no room, and leaves the scoped outline on the
					    box it already framed — a padding here would carry that
					    outline up with it. */}
						<div
							aria-hidden
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								top: -TRACK_HIT_PADDING,
								height: TRACK_HIT_PADDING,
							}}
						/>

						{chart.hoveredSegment && (
							<SegmentHighlight
								segment={chart.hoveredSegment}
								fractionForTime={axis.fractionForTime}
							/>
						)}

						<div
							ref={chart.trackRef}
							style={{
								position: 'relative',
								width: '100%',
								height:
									layoutMode === 'real' ? EVENTS_SCATTER_HEIGHT : TRACK_HEIGHT,
								paddingTop:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								paddingBottom:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								boxSizing: 'content-box',
								display: 'flex',
								alignItems: 'center',
							}}
						>
							<TrackBaseline
								color={chart.issueSeriesColor}
								anchor={layoutMode === 'even' ? 'bottom' : 'centre'}
							/>

							{/* The axis reads 00:00 / 12:00 / 24:00, which is a lie once the
							    window is shorter than a day — every dot sits in one band. */}
							{layoutMode === 'real' && axis.span >= DAY_MS && (
								<HourAxisLabels />
							)}

							{chart.showIssues && layoutMode === 'even' && (
								<>
									{/* Before the bars, so it stays underneath them. */}
									{chart.hoveredBucketIndex !== null && (
										<BucketHighlight
											index={chart.hoveredBucketIndex}
											bucketCount={axis.bucketCount}
										/>
									)}

									<SeriesLayer key={`issues-${windowKey}`} animate={animate}>
										<VolumeBars
											bars={chart.issueBars}
											bucketCount={axis.bucketCount}
											firstBar={chart.issueBarRange[0]}
											lastBar={chart.issueBarRange[1]}
											color={chart.issueSeriesColor}
											direction="up"
											animate={animate}
										/>
									</SeriesLayer>
								</>
							)}

							{/* Both series share one canvas: they are drawn against the
						    same axes, and one node replaces thousands. */}
							{layoutMode === 'real' && (
								<ScatterCanvas
									layers={chart.scatterLayers}
									animate={animate}
									highlightId={chart.highlightEventId}
									onPointEnter={on.onScatterPointEnter}
									onPointLeave={on.onScatterPointLeave}
									onPressCommit={on.onPressCommit}
								/>
							)}
						</div>

						{chart.showCommits &&
							layoutMode === 'even' &&
							chart.commits.length > 0 && (
								<div
									key={`commits-${windowKey}`}
									// Clears the board hover and stops the move reaching the
									// wrapper, so the two hints never stack at the same spot.
									onMouseEnter={on.onCommitTrackMouseEnter}
									onMouseMove={on.onCommitTrackMouseMove}
									onMouseLeave={on.onCommitTrackMouseLeave}
									style={{
										position: 'relative',
										width: '100%',
										height: TRACK_HEIGHT,
										animation: animate ? FADE_IN_ANIMATION : undefined,
									}}
								>
									<TrackBaseline color={GUI_THEME.green} anchor="top" />

									{chart.hoveredCommitBucketIndex !== null && (
										<BucketHighlight
											index={chart.hoveredCommitBucketIndex}
											bucketCount={axis.bucketCount}
										/>
									)}

									<VolumeBars
										bars={chart.commitBars}
										bucketCount={axis.bucketCount}
										firstBar={chart.commitBarRange[0]}
										lastBar={chart.commitBarRange[1]}
										color={GUI_THEME.green}
										direction="down"
										animate={animate}
									/>
								</div>
							)}

						{chart.thumbFraction !== null && (
							<ScrubberNeedle
								fraction={chart.thumbFraction}
								onGrab={on.onGrabNeedle}
							/>
						)}

						{chart.rangeSelection && (
							<RangeSelection {...chart.rangeSelection} />
						)}

						{/* Both hints belong on the wrapper so they hang below the whole
						    scrubber rather than on top of the commit chart. */}
						{chart.boardHint && (
							<ScrubberHoverHint
								{...chart.boardHint}
								segmentLabel={chart.hoveredSegment?.label}
								stripeColor={chart.issueSeriesColor}
								trackWidthPx={chart.trackWidthPx}
							/>
						)}

						{chart.commitHint && (
							<ScrubberHoverHint
								{...chart.commitHint}
								segmentLabel={chart.hoveredSegment?.label}
								stripeColor={GUI_THEME.green}
								trackWidthPx={chart.trackWidthPx}
							/>
						)}
					</div>
				)}
			</div>
		</Panel>
	);
};
