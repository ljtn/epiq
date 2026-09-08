import {useState} from 'react';
import {LaneStayPoint} from '../../../lib/stats/swimlane-stats.model.js';
import {formatDuration} from '../lib/gui-format.helper';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// The lane's median stay, once a day, for the last month.
//
// One series, so no legend: the section heading above says what is plotted, and
// a box holding a single swatch would only repeat it. The endpoint is the only
// labelled value — a number on every point is chaos and goes unread — and the
// rest is a slope, which is the whole reason this is a line and not four more
// figures.

const HEIGHT = 68;
// Room under the plot for the two date labels, and over it for the endpoint's
// own value, so neither has to sit on the line.
const PAD_TOP = 14;
const PAD_BOTTOM = 16;
const PAD_RIGHT = 40;

const DAY = 24 * 60 * 60 * 1000;

type Measured = LaneStayPoint & {median: number};

type Plotted = {x: number; y: number; point: Measured};

const dayLabel = (t: number, now: number): string => {
	const days = Math.round((now - t) / DAY);

	if (days <= 0) return 'today';

	return `${formatDuration(days * DAY)} ago`;
};

export const StayTrend = ({points}: {points: LaneStayPoint[]}) => {
	const [hovered, setHovered] = useState<Plotted | null>(null);
	const [width, setWidth] = useState(0);

	const measured = points.filter(
		(point): point is Measured => point.median !== null,
	);

	// One reading is a dot, not a trend, and nothing at all is not a chart.
	if (measured.length < 2 || width === 0) {
		return (
			<div
				ref={element => setWidth(element?.clientWidth ?? 0)}
				style={{height: HEIGHT, marginTop: 12}}
			/>
		);
	}

	const now = points.at(-1)!.t;
	const first = points[0]!.t;
	const span = Math.max(1, now - first);
	const peak = Math.max(...measured.map(point => point.median));

	const plotWidth = Math.max(1, width - PAD_RIGHT);
	const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

	const plot = (point: Measured): Plotted => ({
		x: ((point.t - first) / span) * plotWidth,
		// Off a floor of zero rather than the range's own low: a line that fills
		// the box whatever it does turns a flat month into a mountain.
		y: PAD_TOP + plotHeight - (point.median / Math.max(1, peak)) * plotHeight,
		point,
	});

	const plotted = measured.map(plot);
	const last = plotted.at(-1)!;

	// Gaps rather than a bridge: a day the lane stood empty is not a value to
	// interpolate through, and joining across it would invent one. Each run of
	// consecutive days is its own line and its own fill, so neither reaches
	// across the hole.
	const runs = plotted.reduce<Plotted[][]>((groups, entry, index) => {
		const previous = measured[index - 1];
		const broken =
			previous !== undefined &&
			Math.round((entry.point.t - previous.t) / DAY) > 1;

		if (index === 0 || broken) groups.push([]);
		groups.at(-1)!.push(entry);

		return groups;
	}, []);

	const at = (entry: Plotted) => `${entry.x.toFixed(1)} ${entry.y.toFixed(1)}`;

	// A single day's run is `M x y L x y`, which a round cap draws as a dot —
	// an `M` on its own would draw nothing at all.
	const lineOf = (run: Plotted[]) =>
		run.length === 1
			? `M${at(run[0]!)} L${at(run[0]!)}`
			: run
					.map((entry, index) => `${index === 0 ? 'M' : 'L'}${at(entry)}`)
					.join(' ');

	const base = PAD_TOP + plotHeight;

	const areaOf = (run: Plotted[]) =>
		`${lineOf(run)} L${run.at(-1)!.x.toFixed(1)} ${base} L${run[0]!.x.toFixed(
			1,
		)} ${base} Z`;

	// One mark a week back from today, so a stretch of the line can be counted
	// off the right-hand edge as this week, last week, the week before.
	const weekMarks = Array.from(
		{length: Math.floor((points.length - 1) / 7)},
		(_, index) => ((span - (index + 1) * 7 * DAY) / span) * plotWidth,
	).filter(x => x > 0);

	const nearest = (offsetX: number): Plotted =>
		plotted.reduce((best, entry) =>
			Math.abs(entry.x - offsetX) < Math.abs(best.x - offsetX) ? entry : best,
		);

	return (
		<div
			ref={element => setWidth(element?.clientWidth ?? 0)}
			style={{position: 'relative', marginTop: 12}}
		>
			<svg
				width="100%"
				height={HEIGHT}
				role="img"
				aria-label={`Median stay over the last ${
					points.length
				} days, now ${formatDuration(last.point.median)}`}
				style={{display: 'block', overflow: 'visible'}}
				onMouseLeave={() => setHovered(null)}
				onMouseMove={event =>
					setHovered(
						nearest(
							event.clientX - event.currentTarget.getBoundingClientRect().left,
						),
					)
				}
			>
				{/* Behind everything, and the same recessive hairline the peak
				    wears: a week boundary is a place to read the line against, not
				    a thing to look at. */}
				{weekMarks.map(x => (
					<line
						key={x}
						x1={x}
						x2={x}
						y1={PAD_TOP}
						y2={base}
						stroke={GUI_THEME.line}
						strokeWidth={1}
					/>
				))}

				{/* One hairline at the peak, labelled, so the height of the line
				    has a value attached to it without an axis down the side. */}
				<line
					x1={0}
					x2={plotWidth}
					y1={PAD_TOP}
					y2={PAD_TOP}
					stroke={GUI_THEME.line}
					strokeWidth={1}
				/>

				{/* What the height means, and what the top of it is worth — so a
				    line sitting high reads as a long wait rather than as a big
				    number of something unnamed. */}
				<text
					x={0}
					y={PAD_TOP - 4}
					fill={GUI_THEME.dim}
					fontSize={TEXT.label}
					fontFamily="inherit"
				>
					median stay
				</text>

				<text
					x={plotWidth}
					y={PAD_TOP - 4}
					textAnchor="end"
					fill={GUI_THEME.dim}
					fontSize={TEXT.label}
					fontFamily="inherit"
				>
					{formatDuration(peak) || '0s'}
				</text>

				{runs.map(run => (
					<path
						key={`area-${run[0]!.point.t}`}
						d={areaOf(run)}
						fill={GUI_THEME.accent}
						opacity={0.1}
						stroke="none"
					/>
				))}

				{runs.map(run => (
					<path
						key={`line-${run[0]!.point.t}`}
						d={lineOf(run)}
						fill="none"
						stroke={GUI_THEME.accent}
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				))}

				{hovered && (
					<line
						x1={hovered.x}
						x2={hovered.x}
						y1={PAD_TOP}
						y2={base}
						stroke={GUI_THEME.dim}
						strokeWidth={1}
					/>
				)}

				{/* The 2px ring is the surface showing through, so the dot stays
				    legible where it sits on the line. */}
				<circle
					cx={hovered?.x ?? last.x}
					cy={hovered?.y ?? last.y}
					r={4}
					fill={GUI_THEME.accent}
					stroke={GUI_THEME.panel}
					strokeWidth={2}
				/>

				<text
					x={(hovered ?? last).x + 8}
					y={(hovered ?? last).y + 4}
					fill={GUI_THEME.primary}
					fontSize={TEXT.meta}
					fontFamily="inherit"
				>
					{formatDuration((hovered ?? last).point.median) || '0s'}
				</text>

				<text
					x={0}
					y={HEIGHT - 2}
					fill={GUI_THEME.dim}
					fontSize={TEXT.label}
					fontFamily="inherit"
				>
					{dayLabel(first, now)}
				</text>

				<text
					x={plotWidth}
					y={HEIGHT - 2}
					textAnchor="end"
					fill={GUI_THEME.dim}
					fontSize={TEXT.label}
					fontFamily="inherit"
				>
					{hovered ? dayLabel(hovered.point.t, now) : 'today'}
				</text>
			</svg>
		</div>
	);
};
