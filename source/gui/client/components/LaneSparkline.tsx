import {useEffect, useId, useRef} from 'react';
import {LaneStayPoint} from '../../../lib/stats/swimlane-stats.model.js';
import {GUI_THEME} from '../lib/gui-theme';

// The lane's stay trend, in its own header, at the weight of the border.
//
// Deliberately mute and deliberately dumb: no axis, no numbers, no hover, no
// hit target. It is there to be caught out of the corner of the eye — a shape
// that is climbing or is not — and the panel one click away is where the same
// curve carries values.
//
// Only the most recent unbroken run of days is drawn. The panel breaks its line
// across the days a lane stood empty, which is the honest thing at 400px wide;
// at this size the same break is confetti, and three disconnected strokes read
// as a glitch rather than as a gap.

const WIDTH = 112;
const HEIGHT = 14;

const DAY = 86_400_000;

// Matches the column's own `proximityReach`, so the curve and the border it is
// drawn in come up together.
const REACH = 200;

// The lit copy replaces the curve rather than tinting it. `secondary` is still
// a muted blue-grey — a hint at its loudest — but it has to clear the resting
// curve to be seen at all: at 0.3 over a brighter resting curve the two
// measured 87 and 102, a lift nobody can see.
const BRIGHTEST = 1;

const GLOW_VAR = '--spark-glow';

// The plot ground at full proximity. A hint of one: enough that the trace has
// something to sit on, well short of a panel of its own.
const GROUND = 0.05;

// A week's worth of upright per gridline. Barely there at rest and a little
// more as the pointer arrives: with the axes gone the grid is the only frame
// the curve has, and a trace floating in an empty header was what the frame
// was added to fix.
const GRID_REST = 0.05;
const GRID_GAIN = 0.12;

// The gridlines' own ink, one step back from the curve's.
const AXIS = GUI_THEME.dim2;

// The data sits a step above its frame — `dim2`, held back a little, so it
// still reads as a hint rather than as a chart demanding to be read, but is
// plainly the thing the axes are there for.
const CURVE = GUI_THEME.dim2;

// Quiet at rest — it is background until looked at — and the lit copy over it
// is what makes approaching worth anything.
const CURVE_OPACITY = 0.4;

type Measured = LaneStayPoint & {median: number};

const latestRun = (points: LaneStayPoint[]): Measured[] => {
	const run: Measured[] = [];

	for (let index = points.length - 1; index >= 0; index--) {
		const point = points[index]!;
		if (point.median === null) break;

		run.unshift(point as Measured);
	}

	return run;
};

/**
 * A three-day centred mean over the readings.
 *
 * The panel plots the days as they were; this is a hint, and a single busy
 * afternoon spiking one day's median turns 56px of curve into an EKG. Rounding
 * the readings off first leaves the shape and drops the twitch.
 */
const smoothed = (values: number[]): number[] =>
	values.map((value, index) => {
		const window = [values[index - 1], value, values[index + 1]].filter(
			(entry): entry is number => entry !== undefined,
		);

		return window.reduce((total, entry) => total + entry, 0) / window.length;
	});

/**
 * A Catmull-Rom spline through the points, as cubic beziers.
 *
 * Thirty daily readings across 56px is a picket fence of hard corners, and at
 * this size the corners are noise rather than detail — the shape is the whole
 * message. Each control point is a sixth of the way along its neighbours' span,
 * which is the curve that passes through every point rather than near them.
 */
const smoothPath = (points: {x: number; y: number}[]): string => {
	if (points.length < 2) return '';

	const at = (index: number) =>
		points[Math.min(points.length - 1, Math.max(0, index))]!;

	return points.slice(1).reduce((path, point, index) => {
		const previous = at(index);
		const before = at(index - 1);
		const after = at(index + 2);

		const c1x = previous.x + (point.x - before.x) / 6;
		const c1y = previous.y + (point.y - before.y) / 6;
		const c2x = point.x - (after.x - previous.x) / 6;
		const c2y = point.y - (after.y - previous.y) / 6;

		return `${path} C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(
			1,
		)} ${c2y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
	}, `M${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`);
};

export const LaneSparkline = ({points}: {points: LaneStayPoint[]}) => {
	const ref = useRef<SVGSVGElement | null>(null);
	// React's ids carry colons, which are legal in an id and a minefield in a
	// selector — stripped so `url(#…)` is safe wherever it is read.
	const gradientId = useId().replace(/:/g, '');

	// Proximity to the curve itself rather than to the column, which is what the
	// border does: it lights where the pointer is, not wherever the pointer is
	// somewhere on the panel. Written straight to the node — a pointer sample is
	// not a state change worth telling React about sixty times a second.
	useEffect(() => {
		let sampled = 0;

		const onMove = (event: MouseEvent) => {
			const now = Date.now();
			if (now - sampled < 16) return;
			sampled = now;

			const node = ref.current;
			if (!node) return;

			const rect = node.getBoundingClientRect();
			const dx = Math.max(
				rect.left - event.clientX,
				0,
				event.clientX - rect.right,
			);
			const dy = Math.max(
				rect.top - event.clientY,
				0,
				event.clientY - rect.bottom,
			);
			const distance = Math.hypot(dx, dy);

			node.style.setProperty(
				GLOW_VAR,
				String(distance >= REACH ? 0 : 1 - distance / REACH),
			);
		};

		window.addEventListener('mousemove', onMove);

		return () => window.removeEventListener('mousemove', onMove);
	}, []);

	const run = latestRun(points);

	// One reading is a dot, not a shape.
	if (run.length < 2) return null;

	const first = run[0]!.t;
	const span = Math.max(1, run.at(-1)!.t - first);
	const peak = Math.max(...run.map(point => point.median));

	const medians = smoothed(run.map(point => point.median));

	const path = smoothPath(
		run.map((point, index) => ({
			x: ((point.t - first) / span) * WIDTH,
			y: HEIGHT - 1 - (medians[index]! / Math.max(1, peak)) * (HEIGHT - 2),
		})),
	);

	// One upright a week back from today, so a stretch of the trace can be
	// counted off the right-hand edge as this week, last week, the week before.
	const grid = Array.from(
		{length: Math.floor(span / (7 * DAY))},
		(_, index) => (1 - ((index + 1) * 7 * DAY) / span) * WIDTH,
	)
		.filter(x => x > 1)
		.map(x => `M${x.toFixed(1)} 1 L${x.toFixed(1)} ${HEIGHT - 1}`)
		.join(' ');

	const stroke = {
		d: path,
		fill: 'none',
		strokeWidth: 1,
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
	};

	return (
		<svg
			ref={ref}
			data-testid="lane-sparkline"
			width={WIDTH}
			height={HEIGHT}
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			aria-hidden
			style={{flexShrink: 0, pointerEvents: 'none'}}
		>
			{/* The plot area, lifted off the header only as the pointer arrives —
			    a ground behind the trace is what makes it read as a chart rather
			    than as two lines that happen to meet. Absent at rest, where the
			    whole thing is meant to be nearly invisible. */}
			<rect
				x={0}
				y={0}
				width={WIDTH}
				height={HEIGHT}
				rx={2}
				fill={GUI_THEME.primary}
				style={{
					opacity: `calc(var(${GLOW_VAR}, 0) * ${GROUND})`,
					transition: 'opacity 140ms ease',
				}}
			/>

			{grid && (
				<path
					d={grid}
					fill="none"
					strokeWidth={1}
					stroke={AXIS}
					style={{
						opacity: `calc(${GRID_REST} + var(${GLOW_VAR}, 0) * ${GRID_GAIN})`,
						transition: 'opacity 140ms ease',
					}}
				/>
			)}

			{/* Both ends fade out, so the curve reads as a passing glimpse of
			    something longer rather than as a shape with a start and a stop. */}
			<defs>
				<linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
					<stop offset="0%" stopColor={CURVE} stopOpacity={0} />
					<stop offset="22%" stopColor={CURVE} />
					<stop offset="78%" stopColor={CURVE} />
					<stop offset="100%" stopColor={CURVE} stopOpacity={0} />
				</linearGradient>

				<linearGradient id={`${gradientId}-lit`} x1="0" x2="1" y1="0" y2="0">
					<stop offset="0%" stopColor={GUI_THEME.secondary} stopOpacity={0} />
					<stop offset="22%" stopColor={GUI_THEME.secondary} />
					<stop offset="78%" stopColor={GUI_THEME.secondary} />
					<stop offset="100%" stopColor={GUI_THEME.secondary} stopOpacity={0} />
				</linearGradient>
			</defs>

			<path
				{...stroke}
				stroke={`url(#${gradientId})`}
				opacity={CURVE_OPACITY}
			/>

			<path
				{...stroke}
				stroke={`url(#${gradientId}-lit)`}
				style={{
					opacity: `calc(var(${GLOW_VAR}, 0) * ${BRIGHTEST})`,
					transition: 'opacity 140ms ease',
				}}
			/>
		</svg>
	);
};
