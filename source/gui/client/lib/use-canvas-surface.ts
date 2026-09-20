import {RefObject, useCallback, useEffect, useRef} from 'react';

/**
 * A canvas that stays sharp, and a frame loop that stops when the drawing does.
 *
 * The surface is sized in device pixels with the context scaled to match, or
 * what is drawn on it is blurry on a retina display, and it is resized with its
 * parent. `paint` is asked for a frame on every resize, and on each animation
 * frame while it answers that it is still going; the first frame that says it
 * has settled ends the loop and calls `onSettled`.
 *
 * The scrubber draws two canvases — the flow's strands and the scatter's dots —
 * and they had this apiece, to the line. What differs between them is `paint`,
 * which is the drawing itself; keeping the surface underneath is one job.
 */
export const useCanvasSurface = ({
	canvasRef,
	sizeRef,
	paint,
	onSettled,
}: {
	canvasRef: RefObject<HTMLCanvasElement | null>;
	// Written by the resize, read by whatever computes what to draw: the size in
	// CSS pixels, which is the space the drawing is laid out in.
	sizeRef: RefObject<{width: number; height: number}>;
	// Draws one frame at `now`, and answers whether another is wanted.
	paint: (now: number) => boolean;
	onSettled: () => void;
}) => {
	const frameRef = useRef<number | null>(null);

	// Held in a ref so the loop below is not torn down and rebuilt whenever the
	// caller hands over a fresh closure.
	const onSettledRef = useRef(onSettled);
	onSettledRef.current = onSettled;

	const run = useCallback(() => {
		if (frameRef.current !== null) return;

		const step = () => {
			frameRef.current = null;

			if (paint(performance.now())) {
				frameRef.current = requestAnimationFrame(step);
			} else {
				onSettledRef.current();
			}
		};

		frameRef.current = requestAnimationFrame(step);
	}, [paint]);

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
	}, [paint, canvasRef, sizeRef]);

	// The frame outlives the component otherwise, and paints onto a canvas that
	// has gone.
	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	// Whether a frame is already pending, for a caller with a repaint to do that
	// an entrance already under way would do for it.
	const isPainting = useCallback(() => frameRef.current !== null, []);

	return {run, isPainting};
};
