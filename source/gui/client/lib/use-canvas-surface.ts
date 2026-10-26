import {RefObject, useCallback, useEffect, useRef} from 'react';

/**
 * A canvas sized in device pixels, and a frame loop that runs while `paint`
 * says it is still going, then calls `onSettled`.
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
