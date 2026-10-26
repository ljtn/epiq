// The scrubber's markup: where header, controls, charts, needle and hints go.
// TimeScrubber owns the logic.

import {memo, useEffect, useRef} from 'react';
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
	LiveToggle,
	ReturnToNowButton,
	ScrubberPlayButton,
} from './ScrubberControls';
import {
	BucketHighlight,
	FlowStrandLabels,
	HourAxisLabels,
	RangeSelection,
	ScrubberHoverHint,
	ScrubberNeedle,
	UnappliedStretch,
	SegmentBoundaries,
	SegmentHighlight,
	SeriesLayer,
	StackedVolumeBars,
	TrackBaseline,
	VolumeBars,
} from './ScrubberTrack';
import {Panel} from './Panel';
import {REVEAL_MS, useReveal} from '../lib/use-reveal';

const DAY_MS = 24 * 60 * 60 * 1000;

// Module scope, so the memoized bars aren't re-rendered on every mouse move.
const LINE_BAR_COLORS = {top: GUI_THEME.red, bottom: GUI_THEME.green};

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
	// Wraps both charts; a native wheel listener pages the window (React's can't preventDefault).
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
	// The other measure: the lines those commits moved, one entry per bucket with
	// each half already a fraction of the track, stacked from the same edge.
	linesMeasure: boolean;
	lineBars: {index: number; top: number; bottom: number}[];
	lineBarRange: [number, number];
	// One entry per series, each animating in and out on its own.
	scatterLayers: ScatterLayer[];
	// The strata for the flow layout, and the one ticket singled out on it —
	// hovered, or the owner of a hovered log row.
	flowChart: FlowChart;
	flowFocusIssue: string | null;
	// The Board series' colour under the current view, so the bars and the
	// baseline say the same thing the scatter's dots do.
	issueSeriesColor: string;
	// Dots stop being hover targets mid-drag, or each one crossed sets state.
	dragging: boolean;
	// The stretch a range drag has covered so far, in track fractions, or null
	// when no range is being dragged out.
	rangeSelection: {from: number; to: number} | null;
	commits: readonly GuiCommitEntry[];
	hoveredCommitSha: string | null;
	hoveredBucketIndex: number | null;
	hoveredCommitBucketIndex: number | null;
	hoveredSegment: Segment | null;
	// The track's segment grain, and the segment under the pointer.
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
	// Where the unapplied stretch begins, or null. Not the needle: a zoom can hide it.
	unappliedFrom: number | null;
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
	// The history player owns the board's position: controls dim, charts stay lit.
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
	// Track heights slide when a series folds, never on a layout change.
	const shownLayout = useRef(layoutMode);
	const layoutChanged = shownLayout.current !== layoutMode;
	useEffect(() => {
		shownLayout.current = layoutMode;
	}, [layoutMode]);
	const foldAnimate = animate && !layoutChanged;
	// The charts unmount while shut, held only through the closing move.
	const track = useReveal(!collapsed, animate ? REVEAL_MS : 0);
	// The commit bars outlive the box being unticked by the length of the fold,
	// and no longer: what is folded to nothing draws nothing.
	const commits = useReveal(chart.showCommits, animate ? REVEAL_MS : 0);

	return (
		<Panel
			as="div"
			borderColor={GUI_THEME.line}
			borderRadius={0}
			style={{
				borderLeft: 'none',
				borderRight: 'none',
				borderTop: 'none',
				padding: '20px 30px 18px',
				// Lets the hint overhang; safe only because this panel is square.
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
						// The same gap as between the control groups.
						gap: 20,
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
						// Kept reachable while collapsed: the transport and the narrowing, which a
						// link can turn on with the scrubber shut.
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

							{/* Collapsed, the transport keeps both halves. */}
							<span
								style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
							>
								<LiveToggle
									following={controls.following}
									disabled={!controls.canFollow}
									title={controls.followTitle}
									onChange={controls.onChangeFollowing}
								/>

								<ScrubberPlayButton
									canPlay={canPlay}
									playTitle={playTitle}
									onPlay={onPlay}
								/>
							</span>
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

				{track.mounted && (
					// The fold: a grid row from `0fr` to `1fr`, so no height is measured. Unclipped
					// once open, as the grip, pager and scope draw past the track.
					<div
						style={{
							display: 'grid',
							gridTemplateRows: track.shown ? '1fr' : '0fr',
							transition: animate
								? `grid-template-rows ${REVEAL_MS}ms ease`
								: undefined,
						}}
					>
						<div
							style={{
								overflow: track.settled ? 'visible' : 'hidden',
								minHeight: 0,
							}}
						>
							{/* Wraps both charts, so highlight, drag and hover span them and the gap. */}
							<div
								data-testid="scrubber-track"
								// Zero with no window yet, when a press asks for now.
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
									// No gap beside a folded-away track; it closes with the track.
									gap:
										layoutMode === 'even' &&
										!(chart.showIssues && chart.showCommits)
											? 0
											: 8,
									transition: animate ? `gap ${REVEAL_MS}ms ease` : undefined,
									// Crosshair, not a hand: a press picks a moment but a drag picks
									// out a range, and the pointer has to say the second is on offer.
									cursor: chart.connected ? 'crosshair' : 'default',
									// A drag must never turn into a native text selection or a drag
									// of the axis labels underneath the pointer.
									userSelect: 'none',
									WebkitUserSelect: 'none',
								}}
							>
								{/* The scope box. Positioned, not an outline, so it takes no space and can
								    inset each edge differently (the grip overhangs the live end). */}
								{chart.scoped && (
									<div
										aria-hidden
										data-testid="scrubber-scoped"
										style={{
											position: 'absolute',
											inset: `${-SCOPED_OUTLINE_INSET_Y}px ${-SCOPED_OUTLINE_INSET_X}px`,
											border: `1px solid ${SCOPED_OUTLINE_COLOR}`,
											// Cornered like the row's buttons.
											borderRadius: 2,
											pointerEvents: 'none',
										}}
									/>
								)}

								{/* The gap above the charts as a pointer target only. */}
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

								{/* Kept mounted with the series off, since pointer geometry is measured off it;
								    folded to nothing in volume layout. */}
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
										transition: foldAnimate
											? `height ${REVEAL_MS}ms ease`
											: undefined,
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

											<SeriesLayer
												key={`issues-${windowKey}`}
												animate={animate}
											>
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

								{/* Up whenever the series is, so the height doesn't follow the data. */}
								{layoutMode === 'even' && (
									// Folded rather than removed, so unticking slides it out; bars drop once folded.
									<div
										style={{
											height: chart.showCommits ? TRACK_HEIGHT : 0,
											overflow: 'hidden',
											flexShrink: 0,
											transition: foldAnimate
												? `height ${REVEAL_MS}ms ease`
												: undefined,
										}}
									>
										{commits.mounted && (
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

												{chart.linesMeasure ? (
													// What the window churned, the colours dividing a full-height bar.
													<StackedVolumeBars
														segments={chart.lineBars}
														bucketCount={axis.bucketCount}
														firstBar={chart.lineBarRange[0]}
														lastBar={chart.lineBarRange[1]}
														colors={LINE_BAR_COLORS}
														animate={animate}
													/>
												) : (
													<VolumeBars
														bars={chart.commitBars}
														bucketCount={axis.bucketCount}
														firstBar={chart.commitBarRange[0]}
														lastBar={chart.commitBarRange[1]}
														color={GUI_THEME.green}
														direction="down"
														animate={animate}
														testId="commit-bar"
													/>
												)}
											</div>
										)}
									</div>
								)}

								{chart.unappliedFrom !== null && (
									<UnappliedStretch from={chart.unappliedFrom} />
								)}

								{chart.thumbFraction !== null && (
									<ScrubberNeedle
										fraction={chart.thumbFraction}
										parked={controls.isScrubbing}
										onGrab={on.onGrabNeedle}
									/>
								)}

								{/* On the chart at the end it sends the needle to. Gone during a movie, which
								    the player exits. */}
								{!standDown && (
									<ReturnToNowButton
										isScrubbing={controls.isScrubbing}
										onReturnToLive={controls.onReturnToLive}
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

								{/* The pager, in the panel margin either side; shown on hover only where the
								    window can go. */}
								{chart.paging.earlier && (
									<PageArrow side="earlier" onPage={on.onPageEarlier} />
								)}
								{chart.paging.later && (
									<PageArrow side="later" onPage={on.onPageLater} />
								)}

								{/* Names a window no scope button does, in the track's top corner. */}
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
						</div>
					</div>
				)}
			</div>
		</Panel>
	);
};
