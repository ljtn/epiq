// The punchcard, drawn to a canvas rather than to DOM nodes. A window can
// hold twenty thousand points and one node each is more than a browser will
// animate, so this owns its own entrance and exit and its own hit testing.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	DOT_EXIT_TOTAL_MS,
	dotEntranceScale,
	dotExitScale,
	EVENTS_MODE_VERTICAL_PADDING,
	EVENTS_SCATTER_HEIGHT,
} from '../lib/scrubber';

export type ScatterPoint = {
	key: string;
	// Set only on a per-event dot, which is what a log row can be matched to.
	id: string | null;
	// The moment the point stands for, for the hint's own labelling.
	t: number;
	// x across the window, y as time of day — the punchcard's two axes.
	fraction: number;
	hourFraction: number;
	radius: number;
	color: string;
	opacity: number;
	title: string;
	commitSha: string | null;
};

// One series. Each animates on its own, so unticking "Code" retracts the
// commits while the board events stay put.
export type ScatterLayer = {
	id: string;
	points: ScatterPoint[];
	// Changing this replays the entrance for this layer.
	generation: string;
	// On its way out: draw the retraction, then stop drawing it at all.
	leaving: boolean;
};

type Phase = {mode: 'in' | 'out'; startedAt: number};

// How near the pointer has to be, in px, to count as over a dot. Larger than
// the dots themselves: they are 2px radius and would be almost unhittable.
const HIT_RADIUS = 7;

const pointAt = (
	layers: readonly ScatterLayer[],
	x: number,
	y: number,
	width: number,
): ScatterPoint | null => {
	let best: ScatterPoint | null = null;
	let bestDistance = HIT_RADIUS * HIT_RADIUS;

	for (const layer of layers) {
		if (layer.leaving) continue;

		for (const point of layer.points) {
			const dx = point.fraction * width - x;
			const dy =
				EVENTS_MODE_VERTICAL_PADDING +
				point.hourFraction * EVENTS_SCATTER_HEIGHT -
				y;
			const distance = dx * dx + dy * dy;

			if (distance <= bestDistance) {
				bestDistance = distance;
				best = point;
			}
		}
	}

	return best;
};

// One node instead of one per event. At 2.2k dots the DOM version was 93% of
// the whole document, and every frame that touched an ancestor paid for it.
// Drawing them costs the same whether there are ten or ten thousand.
// Everything else fades to this while one event is singled out, so the dot that
// stays at full strength reads as the answer.
const DIMMED_ALPHA = 0.08;
const HIGHLIGHT_RADIUS_SCALE = 2.2;

export const ScatterCanvas = ({
	layers,
	animate,
	highlightId,
	onPointEnter,
	onPointLeave,
	onPressCommit,
}: {
	layers: readonly ScatterLayer[];
	animate: boolean;
	// The one event to single out, or null for the plain chart.
	highlightId: string | null;
	onPointEnter: (point: ScatterPoint) => void;
	onPointLeave: () => void;
	// The commit a press landed on, or null for anywhere else. Reported rather
	// than acted on: the track holds the pointer capture, so it is the one that
	// can tell this press apart from the start of a range drag.
	onPressCommit: (sha: string | null) => void;
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sizeRef = useRef({width: 0, height: 0});
	// Read through refs by the draw loop, so a data change never restarts it.
	const layersRef = useRef(layers);
	layersRef.current = layers;
	// Only dims when the highlighted event is actually on the chart. It may not
	// be: an event outside the fetched window has no dot, and the bucketed
	// fallback dots carry no id at all.
	// Memoized: this walks every plotted point, and the track re-renders on
	// every mouse move.
	const activeHighlight = useMemo(
		() =>
			highlightId !== null &&
			layers.some(layer => layer.points.some(point => point.id === highlightId))
				? highlightId
				: null,
		[layers, highlightId],
	);
	const highlightRef = useRef(activeHighlight);
	highlightRef.current = activeHighlight;
	const phasesRef = useRef(new Map<string, Phase>());
	const frameRef = useRef<number | null>(null);
	const hoveredRef = useRef<string | null>(null);
	// The scatter's entrance is drawn, not animated by CSS, so it emits no
	// animationstart for a test to observe. This says the same thing.
	const [entrancePlaying, setEntrancePlaying] = useState(false);

	const paint = useCallback((now: number) => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return false;

		const {width, height} = sizeRef.current;
		context.clearRect(0, 0, width, height);

		let running = false;

		for (const layer of layersRef.current) {
			const phase = phasesRef.current.get(layer.id);
			const elapsed = phase ? now - phase.startedAt : null;
			const done = elapsed === null || elapsed >= DOT_EXIT_TOTAL_MS;

			if (phase && !done) running = true;
			// A finished exit leaves nothing behind.
			if (phase?.mode === 'out' && done) continue;

			for (const point of layer.points) {
				const scale =
					phase === null || phase === undefined || done
						? 1
						: phase.mode === 'in'
						? dotEntranceScale(point.key, elapsed!)
						: dotExitScale(point.key, elapsed!);

				if (scale <= 0) continue;

				const highlight = highlightRef.current;
				const isHighlighted = highlight !== null && point.id === highlight;
				const radiusScale =
					scale * (isHighlighted ? HIGHLIGHT_RADIUS_SCALE : 1);
				const cx = point.fraction * width;
				const cy =
					EVENTS_MODE_VERTICAL_PADDING +
					point.hourFraction * EVENTS_SCATTER_HEIGHT;

				context.globalAlpha =
					highlight === null ? point.opacity : isHighlighted ? 1 : DIMMED_ALPHA;
				context.fillStyle = point.color;
				context.beginPath();
				context.arc(cx, cy, point.radius * radiusScale, 0, Math.PI * 2);
				context.fill();

				// A halo as well as a bigger dot: at 2-3px a size change alone is easy
				// to miss on a track holding hundreds of them.
				if (isHighlighted) {
					context.globalAlpha = 0.25;
					context.beginPath();
					context.arc(cx, cy, point.radius * radiusScale * 2.4, 0, Math.PI * 2);
					context.fill();
				}
			}
		}

		context.globalAlpha = 1;

		return running;
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

	// The backing store is sized in device pixels and the context scaled to
	// match, or the dots are blurry on a retina display.
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

	// Each layer starts its own entrance or exit. Scrubbing changes neither, so
	// it never animates.
	const signature = layers
		.map(layer => `${layer.id}:${layer.generation}:${layer.leaving}`)
		.join('|');

	useEffect(() => {
		const seen = new Set<string>();

		for (const layer of layers) {
			seen.add(layer.id);
			const key = `${layer.generation}:${layer.leaving}`;
			const marker = `${layer.id}@${key}`;
			const current = phasesRef.current.get(layer.id);

			if (
				(current as (Phase & {marker?: string}) | undefined)?.marker === marker
			)
				continue;

			if (!animate) {
				phasesRef.current.delete(layer.id);
				continue;
			}

			phasesRef.current.set(layer.id, {
				mode: layer.leaving ? 'out' : 'in',
				startedAt: performance.now(),
				marker,
			} as Phase);

			if (!layer.leaving) setEntrancePlaying(true);
		}

		for (const id of [...phasesRef.current.keys()])
			if (!seen.has(id)) phasesRef.current.delete(id);

		if (animate) run();
		else paint(performance.now());
	}, [signature, animate, run, paint]);

	// Repaint when the data or the highlight changes without a new entrance.
	useEffect(() => {
		if (frameRef.current === null) paint(performance.now());
	}, [layers, activeHighlight, paint]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	const hitTest = (event: React.MouseEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();

		return pointAt(
			layersRef.current,
			event.clientX - rect.left,
			event.clientY - rect.top,
			rect.width,
		);
	};

	return (
		<canvas
			ref={canvasRef}
			data-testid="scatter-canvas"
			data-entrance={entrancePlaying ? 'playing' : 'done'}
			data-highlight={activeHighlight ?? ''}
			style={{position: 'absolute', inset: 0}}
			onMouseMove={event => {
				const point = hitTest(event);
				if (point?.key === hoveredRef.current) return;

				hoveredRef.current = point?.key ?? null;
				if (point) onPointEnter(point);
				else onPointLeave();
			}}
			onMouseLeave={() => {
				hoveredRef.current = null;
				onPointLeave();
			}}
			// Never stopped, not even over a commit: every press has to reach the
			// track, or a range drag that begins on a dot never begins at all — and
			// on a busy scatter most of them do. What the press turns out to mean is
			// settled on release, by how far it travelled.
			//
			// There is deliberately no onClick here. The track takes pointer
			// capture, which retargets the compatibility mouse events with it, so a
			// click on the canvas is not the canvas's to hear.
			onPointerDown={event => onPressCommit(hitTest(event)?.commitSha ?? null)}
		/>
	);
};
