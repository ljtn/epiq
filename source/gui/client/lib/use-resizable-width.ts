// A panel's width, dragged from one of its edges and remembered across opens.
// The plain case, for a panel that only ever sits on one side; the ticket
// panel's own drag has docking and fullscreen tangled into it and stays there.

import {useCallback, useEffect, useRef, useState} from 'react';

export const useResizableWidth = ({
	storageKey,
	fallback,
	min,
	max,
	grows,
}: {
	storageKey: string;
	fallback: number;
	min: number;
	// Read when a drag starts rather than once: the ceiling follows the window.
	max: () => number;
	// The way the handle travels to grow the panel — right for a panel on the
	// left of the screen, left for one on the right.
	grows: 'left' | 'right';
}) => {
	const [width, setWidth] = useState(() => {
		const stored = Number(localStorage.getItem(storageKey));

		return Number.isFinite(stored) && stored >= min ? stored : fallback;
	});
	const [dragging, setDragging] = useState(false);

	// The drag end reads the width it settles on, and a listener registered at
	// its start would otherwise see the width of that moment.
	const latest = useRef(width);
	useEffect(() => {
		latest.current = width;
	}, [width]);

	const drag = useRef<{pointer: number; size: number; max: number} | null>(
		null,
	);

	const onPointerMove = useCallback(
		(event: PointerEvent) => {
			const start = drag.current;
			if (!start) return;

			const delta =
				grows === 'right'
					? event.clientX - start.pointer
					: start.pointer - event.clientX;

			setWidth(Math.min(start.max, Math.max(min, start.size + delta)));
		},
		[grows, min],
	);

	const onDragEnd = useCallback(() => {
		drag.current = null;
		setDragging(false);
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		localStorage.setItem(storageKey, String(latest.current));
	}, [onPointerMove, storageKey]);

	// A drag left in progress when the panel unmounts would otherwise leave
	// the document-level listeners and the cursor override attached.
	useEffect(() => {
		return () => {
			if (drag.current) onDragEnd();
		};
	}, [onDragEnd]);

	const onPointerDown = (event: React.PointerEvent) => {
		event.preventDefault();

		drag.current = {pointer: event.clientX, size: latest.current, max: max()};
		setDragging(true);
		document.addEventListener('pointermove', onPointerMove);
		document.addEventListener('pointerup', onDragEnd);
		document.body.style.cursor = 'ew-resize';
		document.body.style.userSelect = 'none';
	};

	return {width, dragging, onPointerDown};
};
