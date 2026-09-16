// The scrubber's markup entry point: how the header, controls, charts, needle
// and hints are arranged. The pieces it places come from ScrubberControls,
// ScrubberTrack, ScatterCanvas and FlowCanvas; the numbers it places them at
// from TimeScrubber, which owns all the logic.

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
	FlowChart,
	flowGeometry,
	hourFractionForTime,
	LayoutMode,
	ScrubberAxis,
	SCOPED_OUTLINE_COLOR,
	SCOPED_OUTLINE_INSET_X,
	SCOPED_OUTLINE_INSET_Y,
	PAGE_ARROW_CLASS,
	PAGED_TRACK_CLASS,
	SCRUBBER_KEYFRAMES,
	SCRUBBER_PAGER_STYLES,
	Segment,
	SeriesPresence,
	TRACK_HEIGHT,
	TRACK_HIT_PADDING,
	VolumeBar,
	SegmentBoundary,
} from '../lib/scrubber';
import {IconButton, ICON_BUTTON_SIZE, ICON_SIZE} from './IconButton';
import {IconChevronLeft} from './IconChevronLeft';
import {IconChevronRight} from './IconChevronRight';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {ScatterCanvas, ScatterLayer, ScatterPoint} from './ScatterCanvas';
import {FlowCanvas, FlowHover} from './FlowCanvas';
import {
	ScrubberControls,
	SpotlightToggle,
	TextFilterInput,
	ScrubberHeader,
	ScrubberPlayButton,
} from './ScrubberControls';
import {
	BucketHighlight,
	FlowStrandLabels,
	HourAxisLabels,
	RangeSelection,
	ScrubberHoverHint,
	ScrubberNeedle,
	SegmentBoundaries,
	SegmentHighlight,
	SeriesLayer,
	TrackBaseline,
	VolumeBars,
} from './ScrubberTrack';
import {Panel} from './Panel';

const DAY_MS = 24 * 60 * 60 * 1000;

const dotAnimation = (key: string, animate: boolean, leaving: boolean) =>
	!animate
		? undefined
		: leaving
		? dotExitAnimation(key)
		: dotAppearAnimation(key);

// One end of the chart's pager. Its own pointer events stop here: the track
// behind it reads a press as the corner of a range and a move as a hover.
const PageArrow = ({
	side,
	onPage,
}: {
	side: 'earlier' | 'later';
	onPage: () => void;
}) => (
	<span
		className={PAGE_ARROW_CLASS}
		onPointerDown={event => event.stopPropagation()}
		onMouseMove={event => event.stopPropagation()}
		style={{
			position: 'absolute',
			top: '50%',
			[side === 'earlier' ? 'left' : 'right']: -(ICON_BUTTON_SIZE + 4),
			transform: 'translateY(-50%)',
			display: 'inline-flex',
			cursor: 'default',
		}}
	>
		<IconButton
			testId={side === 'earlier' ? 'page-earlier' : 'page-later'}
			title={side === 'earlier' ? 'Earlier' : 'Later'}
			onClick={onPage}
		>
			{side === 'earlier' ? (
				<IconChevronLeft size={ICON_SIZE} />
			) : (
				<IconChevronRight size={ICON_SIZE} />
			)}
		</IconButton>
	</span>
);

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
	onFlowPathEnter: (hover: FlowHover) => void;
	onFlowPathLeave: () => void;
	onPressFlowPath: (issue: string | null) => void;
	onPressCommit: (sha: string | null) => void;
	// Paging the window from the chart's ends.
	onPageEarlier: () => void;
	onPageLater: () => void;
};

export type ScrubberChart = {
	trackRef: React.RefObject<HTMLDivElement | null>;
	// The wrapper round both charts, which a horizontal wheel over pages the
	// window — the listener is native, for the preventDefault React's cannot
	// give, so it is attached by ref.
	pageRef: React.RefObject<HTMLDivElement | null>;
	// Which way the window can be paged, and what to call the one on screen
	// when the scope buttons do not already say — null while they do.
	paging: {earlier: boolean; later: boolean; label: string | null};
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
	// The strata for the flow layout, and the one ticket singled out on it —
	// hovered, or the owner of a hovered log row.
	flowChart: FlowChart;
	flowFocusIssue: string | null;
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
	commits: readonly GuiCommitEntry[];
	hoveredCommitSha: string | null;
	hoveredBucketIndex: number | null;
	hoveredCommitBucketIndex: number | null;
	hoveredSegment: Segment | null;
	// Where the window is cut into segments, drawn as the track's grain, and
	// the grain segment under the pointer, whose short label gives way to the
	// highlight's full name.
	segmentBoundaries: readonly SegmentBoundary[];
	hoveredGrain: Segment | null;
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
	// The event log panel, switched from the box in this row.
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
	const flowGeo = flowGeometry(chart.flowChart.strands);

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
			<style>{SCRUBBER_PAGER_STYLES}</style>

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
						// The rule that ends the panel toggles carries the break now, so
						// this is the same gap as between the groups of controls, even
						// on either side of it.
						gap: 10,
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
							<TextFilterInput
								value={controls.textFilter}
								onChange={controls.onChangeTextFilter}
							/>

							{controls.windowOnly && (
								<SpotlightToggle
									on
									title="Show every ticket again"
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
						// The stretch the chart is drawing, for anything that has to know
						// whether it is drawing one yet: with no window the axis is a
						// single instant, and a press on it asks for now.
						data-axis-span={Math.round(axis.span)}
						ref={chart.pageRef}
						className={PAGED_TRACK_CLASS}
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
							// No gap under a board track folded away with its series off:
							// the fold is to nothing, not to a blank band.
							gap: layoutMode === 'even' && !chart.showIssues ? 0 : 8,
							// Crosshair, not a hand: a press picks a moment but a drag picks
							// out a range, and the pointer has to say the second is on offer.
							cursor: chart.connected ? 'crosshair' : 'default',
							// A drag must never turn into a native text selection or a drag
							// of the axis labels underneath the pointer.
							userSelect: 'none',
							WebkitUserSelect: 'none',
						}}
					>
						{/* The box that says the board is showing this window and
					    nothing else. Positioned rather than an outline: it takes up
					    no space either way, so narrowing cannot reflow the charts
					    under the pointer that just clicked, but insets can differ
					    per edge where an outline's offset cannot. It needs more room
					    at the sides than above — the needle's grip overhangs the
					    live end by half its width — and less above, where the
					    controls are only TRACK_HIT_PADDING away. */}
						{chart.scoped && (
							<div
								aria-hidden
								data-testid="scrubber-scoped"
								style={{
									position: 'absolute',
									inset: `${-SCOPED_OUTLINE_INSET_Y}px ${-SCOPED_OUTLINE_INSET_X}px`,
									border: `1px solid ${SCOPED_OUTLINE_COLOR}`,
									// Cornered like the row's buttons, not like a card: this is
									// chrome around the chart, and 4px read as a pill on a line
									// this thin.
									borderRadius: 2,
									pointerEvents: 'none',
								}}
							/>
						)}

						{/* The gap above the charts, made part of the track for the
					    pointer and nothing else. Absolutely positioned so it draws
					    nothing and takes no room. */}
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

						<SegmentBoundaries
							boundaries={chart.segmentBoundaries}
							hovered={chart.hoveredGrain}
							fractionForTime={axis.fractionForTime}
						/>

						{chart.hoveredSegment && (
							<SegmentHighlight
								segment={chart.hoveredSegment}
								fractionForTime={axis.fractionForTime}
							/>
						)}

						{/* Kept mounted with the series off — the pointer geometry is
						    measured off it — but folded to nothing in volume layout, the
						    way the commit track below goes when its box is unticked: a
						    series switched off leaves no row, baseline or otherwise. In
						    the scatter both series share this one box, so it stays. */}
						<div
							ref={chart.trackRef}
							style={{
								position: 'relative',
								width: '100%',
								height:
									layoutMode === 'real'
										? EVENTS_SCATTER_HEIGHT
										: layoutMode === 'flow'
										? flowGeo.height
										: chart.showIssues
										? TRACK_HEIGHT
										: 0,
								paddingTop:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								paddingBottom:
									layoutMode === 'real' ? EVENTS_MODE_VERTICAL_PADDING : 0,
								boxSizing: 'content-box',
								display: 'flex',
								alignItems: 'center',
							}}
						>
							{(layoutMode === 'real' ||
								(layoutMode === 'even' && chart.showIssues)) && (
								<TrackBaseline
									color={chart.issueSeriesColor}
									anchor={layoutMode === 'even' ? 'bottom' : 'centre'}
								/>
							)}

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

							{/* The strands draw their own baselines: one per lane. The
							    labels come after the canvas so they sit over the lines. */}
							{layoutMode === 'flow' && (
								<>
									<FlowCanvas
										chart={chart.flowChart}
										fractionForTime={axis.fractionForTime}
										fractionToTime={axis.fractionToTime}
										color={chart.issueSeriesColor}
										animate={animate}
										generation={windowKey}
										focusIssue={chart.flowFocusIssue}
										onPathEnter={on.onFlowPathEnter}
										onPathLeave={on.onFlowPathLeave}
										onPressPath={on.onPressFlowPath}
									/>
									<FlowStrandLabels
										strands={chart.flowChart.strands}
										geometry={flowGeo}
									/>
								</>
							)}
						</div>

						{/* Up whenever the series is, commits or none: an empty window
						    keeps its baseline the way the board track above keeps its,
						    and the scrubber's height does not come and go with what the
						    window happens to hold. */}
						{chart.showCommits && layoutMode === 'even' && (
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
								testId="board-hint"
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

						{/* The pager, off either end of the track in the panel's own
						    margin, so it covers no data. Shown while the chart is
						    hovered — see SCRUBBER_PAGER_STYLES — and only the way the
						    window can actually go. */}
						{chart.paging.earlier && (
							<PageArrow side="earlier" onPage={on.onPageEarlier} />
						)}
						{chart.paging.later && (
							<PageArrow side="later" onPage={on.onPageLater} />
						)}

						{/* What the window is, where no scope button says: a stretch
						    paged back to, dragged out, or cut to a ticket. Tucked into
						    the track's top corner over whatever grain label lands there. */}
						{chart.paging.label !== null && (
							<span
								data-testid="scrubber-window-label"
								style={{
									position: 'absolute',
									top: 1,
									right: 0,
									padding: '0 0 0 4px',
									fontSize: 8,
									lineHeight: 1,
									color: GUI_THEME.dim,
									background: GUI_THEME.panel,
									whiteSpace: 'nowrap',
									pointerEvents: 'none',
								}}
							>
								{chart.paging.label}
							</span>
						)}
					</div>
				)}
			</div>
		</Panel>
	);
};
