// The strata, drawn to a canvas like the punchcard is: a window can hold a
// thousand tickets' lines, and one DOM path each would be a thousand nodes to
// animate. Owns its own entrance and its own hit testing.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	FlowChart,
	FlowPath,
	flowGeometry,
	flowLineY,
	flowPathAt,
	flowStrandCentre,
} from '../lib/scrubber';

// How far a line may be from the pointer, in px, and still be the one hovered.
// Under the slot spacing, so stacked lines answer one at a time.
const HIT_TOLERANCE = 1.5;

// Half the width of a step between strands. A move is a moment, but a vertical
// hairline reads as a glitch; this much lean makes it a step.
const STEP_HALF_WIDTH = 3;

const LINE_WIDTH = 1.2;
const FOCUS_LINE_WIDTH = 2;
const LINE_ALPHA = 0.38;
// Everything else fades to this while one ticket is singled out.
const DIMMED_ALPHA = 0.07;
const STRAND_ALPHA = 0.12;
// The dot a closed ticket's line ends in: it arrived, it did not run off the
// edge.
const CLOSE_DOT_RADIUS = 1.8;

// The wipe the lines come in with, left to right, the way they are read.
const ENTRANCE_MS = 600;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// How quickly a line lights up or the rest dim around it: the time constant
// of an exponential ease. A pointer crossing a braid changes the focus many
// times a second, and a snap at every crossing reads as a flicker.
const FADE_TAU_MS = 90;
// Under this a fade is over.
const FADE_SETTLED = 0.005;
// The step a fade's first frame takes, with no previous frame to measure from.
const FIRST_FRAME_MS = 16;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export type FlowHover = {path: FlowPath; t: number; fraction: number};

export const FlowCanvas = ({
	chart,
	fractionForTime,
	fractionToTime,
	color,
	animate,
	generation,
	focusIssue,
	onPathEnter,
	onPathLeave,
	onPressPath,
}: {
	chart: FlowChart;
	fractionForTime: (t: number) => number;
	fractionToTime: (fraction: number) => number;
	color: string;
	animate: boolean;
	// Changing this replays the entrance.
	generation: string;
	// The one ticket to single out, or null for the plain chart.
	focusIssue: string | null;
	onPathEnter: (hover: FlowHover) => void;
	onPathLeave: () => void;
	// The ticket a press landed on, or null for anywhere else. Reported rather
	// than acted on, as the scatter reports a pressed commit: the track holds
	// the pointer capture, so it is the one that can tell a click from the
	// start of a range drag.
	onPressPath: (issue: string | null) => void;
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sizeRef = useRef({width: 0, height: 0});
	const frameRef = useRef<number | null>(null);
	const entranceStartRef = useRef<number | null>(null);
	const hoveredRef = useRef<string | null>(null);
	// Like the scatter's: the entrance is drawn, not animated by CSS, so this is
	// what a test can observe.
	const [entrancePlaying, setEntrancePlaying] = useState(false);

	// Each vertex's x as a fraction of the track, resolved once per window
	// rather than on every frame of the wipe.
	const plotted = useMemo(
		() =>
			chart.paths.map(path => ({
				path,
				xs: path.vertices.map(vertex => fractionForTime(vertex.t)),
			})),
		[chart, fractionForTime],
	);
	const plottedRef = useRef(plotted);
	plottedRef.current = plotted;
	// Where each strand's band lies, and how its slots fan inside it.
	const geometry = useMemo(() => flowGeometry(chart.strands), [chart.strands]);
	const chartRef = useRef({geometry, strands: chart.strands});
	chartRef.current = {geometry, strands: chart.strands};
	const focusRef = useRef(focusIssue);
	focusRef.current = focusIssue;
	// How lit each line is, 0 to 1, and how dimmed the chart is around a lit
	// one — each eased toward where the focus says it should be, frame by
	// frame, rather than set there.
	const litRef = useRef(new Map<string, number>());
	const dimRef = useRef(0);
	const lastPaintRef = useRef<number | null>(null);
	const animateRef = useRef(animate);
	animateRef.current = animate;
	const colorRef = useRef(color);
	colorRef.current = color;

	const paint = useCallback((now: number) => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return false;

		const {width, height} = sizeRef.current;
		const {geometry, strands} = chartRef.current;
		const strandCount = strands.length;
		const yOf = (strand: number, slot: number) =>
			flowLineY(geometry, strand, slot, strands[strand]!.slots);

		context.clearRect(0, 0, width, height);
		context.strokeStyle = colorRef.current;
		context.fillStyle = colorRef.current;
		context.lineCap = 'round';
		context.lineJoin = 'round';

		// The strands themselves, under the lines.
		context.globalAlpha = STRAND_ALPHA;
		context.lineWidth = 1;

		for (let strand = 0; strand < strandCount; strand++) {
			const y = Math.round(flowStrandCentre(geometry, strand)) + 0.5;
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(width, y);
			context.stroke();
		}

		const started = entranceStartRef.current;
		const elapsed = started === null ? null : now - started;
		const running = elapsed !== null && elapsed < ENTRANCE_MS;
		const revealed = running
			? easeOutCubic(elapsed / ENTRANCE_MS) * width
			: width;

		context.save();
		context.beginPath();
		context.rect(0, 0, revealed, height);
		context.clip();

		const focus = focusRef.current;

		// The step of every fade this frame: all the way with motion off, or
		// the share of the remaining distance the elapsed time covers.
		const last = lastPaintRef.current;
		lastPaintRef.current = now;
		const ease = animateRef.current
			? 1 -
			  Math.exp(-(last === null ? FIRST_FRAME_MS : now - last) / FADE_TAU_MS)
			: 1;
		let fading = false;

		const settle = (current: number, target: number): number => {
			const next = lerp(current, target, ease);
			if (Math.abs(target - next) < FADE_SETTLED) return target;

			fading = true;
			return next;
		};

		dimRef.current = settle(dimRef.current, focus === null ? 0 : 1);
		const dim = dimRef.current;
		const seen = new Set<string>();

		for (const {path, xs} of plottedRef.current) {
			seen.add(path.issue);
			const lit = settle(
				litRef.current.get(path.issue) ?? 0,
				focus !== null && path.issue === focus ? 1 : 0,
			);
			litRef.current.set(path.issue, lit);

			context.globalAlpha = lerp(lerp(LINE_ALPHA, DIMMED_ALPHA, dim), 1, lit);
			context.lineWidth = lerp(LINE_WIDTH, FOCUS_LINE_WIDTH, lit);
			context.strokeStyle = path.color ?? colorRef.current;
			context.fillStyle = context.strokeStyle;
			context.beginPath();

			const first = path.vertices[0]!;
			let x = xs[0]! * width;
			let y = yOf(first.strand, first.slot);
			context.moveTo(x, y);

			for (let index = 1; index < path.vertices.length; index++) {
				const vertex = path.vertices[index]!;
				const nextX = xs[index]! * width;
				const nextY = yOf(vertex.strand, vertex.slot);

				if (nextY === y) {
					context.lineTo(nextX, y);
				} else {
					// Along the strand up to the step, then an S through it. The lean
					// is clipped to the room there is, so two moves in quick
					// succession never run backwards.
					const lean = Math.min(STEP_HALF_WIDTH, (nextX - x) / 2);
					context.lineTo(nextX - lean, y);
					context.bezierCurveTo(nextX, y, nextX, nextY, nextX + lean, nextY);
				}

				x = nextX;
				y = nextY;
			}

			context.stroke();

			if (path.closed) {
				context.beginPath();
				context.arc(x, y, CLOSE_DOT_RADIUS * lerp(1, 1.5, lit), 0, Math.PI * 2);
				context.fill();
			}
		}

		// A line gone from the window takes its weight with it, or a ticket
		// filtered out and back would return already lit.
		for (const issue of [...litRef.current.keys()]) {
			if (!seen.has(issue)) litRef.current.delete(issue);
		}

		context.restore();
		context.globalAlpha = 1;

		if (!running && !fading) lastPaintRef.current = null;

		return running || fading;
	}, []);

	const run = useCallback(() => {
		if (frameRef.current !== null) return;

		const step = () => {
			frameRef.current = null;
			const running = paint(performance.now());

			if (running) frameRef.current = requestAnimationFrame(step);
			else setEntrancePlaying(false);
		};

		frameRef.current = requestAnimationFrame(step);
	}, [paint]);

	// Sized in device pixels with the context scaled to match, or the lines are
	// blurry on a retina display.
	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;

		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			const {width, height} = parent.getBoundingClientRect();

			sizeRef.current = {width, height};
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
			paint(performance.now());
		};

		resize();

		const observer = new ResizeObserver(resize);
		observer.observe(parent);

		return () => observer.disconnect();
	}, [paint]);

	// A new window replays the wipe. Scrubbing and hovering change the picture
	// without changing the window, so they repaint below instead.
	useEffect(() => {
		if (!animate) {
			entranceStartRef.current = null;
			paint(performance.now());
			return;
		}

		entranceStartRef.current = performance.now();
		setEntrancePlaying(true);
		run();
	}, [generation, animate, run, paint]);

	// Repaint when the data or the focus changes without a new entrance. Through
	// the loop rather than a single paint: a focus change starts a fade, which
	// takes frames to settle.
	useEffect(() => {
		run();
	}, [plotted, focusIssue, color, run]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	const hitTest = (event: React.MouseEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
		const t = fractionToTime(fraction);
		const path = flowPathAt(
			chart.paths,
			t,
			event.clientY - rect.top,
			vertex =>
				flowLineY(
					geometry,
					vertex.strand,
					vertex.slot,
					chart.strands[vertex.strand]!.slots,
				),
			HIT_TOLERANCE,
		);

		return path === null ? null : {path, t, fraction};
	};

	return (
		<canvas
			ref={canvasRef}
			data-testid="flow-canvas"
			data-entrance={entrancePlaying ? 'playing' : 'done'}
			data-paths={chart.paths.length}
			data-focus={focusIssue ?? ''}
			style={{position: 'absolute', inset: 0}}
			onMouseMove={event => {
				const hover = hitTest(event);
				const key = hover?.path.issue ?? null;

				// A line is a link to its ticket, and the pointer says so.
				event.currentTarget.style.cursor = hover ? 'pointer' : '';

				// Report a move along the same line: the hint follows the pointer's
				// moment, and the strand under it changes at every step.
				if (hover === null && hoveredRef.current === null) return;

				hoveredRef.current = key;
				if (hover) onPathEnter(hover);
				else onPathLeave();
			}}
			onMouseLeave={() => {
				hoveredRef.current = null;
				onPathLeave();
			}}
			// Never stopped: every press has to reach the track, or a range drag
			// that begins on a line never begins at all. What the press meant is
			// settled on release, by how far it travelled.
			onPointerDown={event => onPressPath(hitTest(event)?.path.issue ?? null)}
		/>
	);
};
