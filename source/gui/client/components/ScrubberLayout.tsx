// The scrubber's markup entry point: how the header, controls, charts, needle
// and hints are arranged. The pieces it places come from ScrubberParts, the
// numbers it places them at from TimeScrubber, which owns all the logic.

import {GuiCommitEntry, GuiEventTimelineBucket} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {
	dotAppearAnimation,
	dotExitAnimation,
	EVENTS_MODE_VERTICAL_PADDING,
	EVENTS_SCATTER_HEIGHT,
	FADE_IN_ANIMATION,
	hourFractionForTime,
	LayoutMode,
	ScrubberAxis,
	SCRUBBER_KEYFRAMES,
	Segment,
	SeriesPresence,
	TRACK_HEIGHT,
	VolumeBar,
} from '../lib/scrubber';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {
	HourAxisLabels,
	ScatterDot,
	ScrubberControls,
	ScrubberHeader,
	ScrubberHoverHint,
	ScrubberNeedle,
	SegmentHighlight,
	SeriesLayer,
	TrackBaseline,
	VolumeBars,
} from './ScrubberParts';
import {Panel} from './Panel';

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
	onTrackMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
	onTrackMouseLeave: () => void;
	onCommitTrackMouseEnter: () => void;
	onCommitTrackMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
	onCommitTrackMouseLeave: () => void;
	onIssueDotEnter: (bucket: GuiEventTimelineBucket) => void;
	onIssueDotLeave: () => void;
	onCommitDotEnter: (commit: GuiCommitEntry) => void;
	onCommitDotLeave: () => void;
	onInspectCommit: (sha: string) => void;
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
	// The server's sparse buckets, plotted as-is in "Events" mode.
	eventBuckets: GuiEventTimelineBucket[];
	maxEventCount: number;
	commits: GuiCommitEntry[];
	hoveredCommitSha: string | null;
	hoveredBucketIndex: number | null;
	hoveredCommitBucketIndex: number | null;
	hoveredSegment: Segment | null;
	thumbFraction: number;
	trackWidthPx: number;
	boardHint: HintContent | null;
	commitHint: HintContent | null;
	on: ScrubberChartHandlers;
};

export const ScrubberLayout = ({
	collapsed,
	onToggleCollapsed,
	scrubbingAsOf,
	controls,
	chart,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
	scrubbingAsOf: string | null;
	controls: React.ComponentProps<typeof ScrubberControls>;
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
			}}
		>
			<style>{SCRUBBER_KEYFRAMES}</style>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: collapsed ? 0 : 8,
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						// Fixed whether or not the banner renders, so the track below
						// never shifts vertically.
						minHeight: 22,
					}}
				>
					<ScrubberHeader
						collapsed={collapsed}
						onToggleCollapsed={onToggleCollapsed}
						scrubbingAsOf={scrubbingAsOf}
					/>

					{!collapsed && <ScrubberControls {...controls} />}
				</div>

				{!collapsed && (
					// Wraps both charts so the period highlight can be one tall block
					// spanning them and the gap between. Pointer handlers belong here
					// rather than on either chart, so a drag or hover anywhere across
					// the pair — the gap included — counts as one timeline.
					<div
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
							cursor: 'pointer',
						}}
					>
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
								color={GUI_THEME.accent}
								anchor={layoutMode === 'even' ? 'bottom' : 'centre'}
							/>

							{layoutMode === 'real' && <HourAxisLabels />}

							{chart.showIssues && layoutMode === 'even' && (
								<SeriesLayer key={`issues-${windowKey}`} animate={animate}>
									<VolumeBars
										bars={chart.issueBars}
										bucketCount={axis.bucketCount}
										firstBar={chart.issueBarRange[0]}
										lastBar={chart.issueBarRange[1]}
										highlightedIndex={chart.hoveredBucketIndex}
										color={GUI_THEME.accent}
										direction="up"
										animate={animate}
									/>
								</SeriesLayer>
							)}

							{/* Both scatter series stay mounted while retracting, so the
							    layer's own fade must sit out an exit — it would fight the
							    dots' reverse twinkle. */}
							{chart.issueScatter.mounted && layoutMode === 'real' && (
								<SeriesLayer
									key={`issues-${windowKey}`}
									animate={animate && !chart.issueScatter.leaving}
								>
									{chart.eventBuckets.map(bucket => {
										const intensity = bucket.count / chart.maxEventCount;

										return (
											<ScatterDot
												key={bucket.t}
												fraction={axis.fractionForTime(bucket.t)}
												hourFraction={hourFractionForTime(bucket.t)}
												size={3 + intensity * 6}
												color={GUI_THEME.accent}
												opacity={0.3 + intensity * 0.5}
												zIndex={2}
												title={`${bucket.count} change${
													bucket.count === 1 ? '' : 's'
												}, ${formatDateTime(new Date(bucket.t))}`}
												animation={dotAnimation(
													String(bucket.t),
													animate,
													chart.issueScatter.leaving,
												)}
												interactive={!chart.issueScatter.leaving}
												onMouseEnter={() => on.onIssueDotEnter(bucket)}
												onMouseLeave={on.onIssueDotLeave}
											/>
										);
									})}
								</SeriesLayer>
							)}

							{/* Commits overlaid on the issue points' own axis. */}
							{chart.commitScatter.mounted &&
								layoutMode === 'real' &&
								chart.commits.length > 0 && (
									<SeriesLayer
										key={`commits-${windowKey}`}
										animate={animate && !chart.commitScatter.leaving}
									>
										{chart.commits.map(commit => (
											<ScatterDot
												key={commit.sha}
												fraction={axis.fractionForTime(commit.time)}
												hourFraction={hourFractionForTime(commit.time)}
												size={4}
												color={GUI_THEME.green}
												opacity={
													chart.hoveredCommitSha === commit.sha ? 1 : 0.55
												}
												zIndex={1}
												title={`${formatDateTime(new Date(commit.time))} — ${
													commit.subject
												} — ${
													commit.author
												} (${commit.linesChanged.toLocaleString()} lines)`}
												animation={dotAnimation(
													commit.sha,
													animate,
													chart.commitScatter.leaving,
												)}
												interactive={!chart.commitScatter.leaving}
												onClick={() => on.onInspectCommit(commit.sha)}
												onMouseEnter={() => on.onCommitDotEnter(commit)}
												onMouseLeave={on.onCommitDotLeave}
											/>
										))}
									</SeriesLayer>
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

									<VolumeBars
										bars={chart.commitBars}
										bucketCount={axis.bucketCount}
										firstBar={chart.commitBarRange[0]}
										lastBar={chart.commitBarRange[1]}
										highlightedIndex={chart.hoveredCommitBucketIndex}
										color={GUI_THEME.green}
										direction="down"
										animate={animate}
									/>
								</div>
							)}

						<ScrubberNeedle fraction={chart.thumbFraction} />

						{/* Both hints belong on the wrapper so they hang below the whole
						    scrubber rather than on top of the commit chart. */}
						{chart.boardHint && (
							<ScrubberHoverHint
								{...chart.boardHint}
								segmentLabel={chart.hoveredSegment?.label}
								stripeColor={GUI_THEME.accent}
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
