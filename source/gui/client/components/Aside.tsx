import React, {
	forwardRef,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const ASIDE_WIDTH = 440;
const MIN_ASIDE_WIDTH = 380;
// Clamped against the live window width too (see handlePointerMove) — this is
// just a sane ceiling on an unusually wide monitor.
const MAX_ASIDE_WIDTH = 1400;
const MAX_ASIDE_WIDTH_RATIO = 0.9;

// Below this, a diff's before/after columns don't have room to stay legible
// side by side; above it, they do. Exported so DiffPanel picks the same
// split/unified boundary the panel itself resizes around.
export const STACKED_DIFF_WIDTH = 760;

const WIDTH_STORAGE_KEY = 'epiq.aside.width';

export const readStoredAsideWidth = (): number => {
	const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));

	return Number.isFinite(stored) &&
		stored >= MIN_ASIDE_WIDTH &&
		stored <= MAX_ASIDE_WIDTH
		? stored
		: ASIDE_WIDTH;
};

export const Aside = forwardRef<
	HTMLElement,
	{children: React.ReactNode; onWidthChange?: (width: number) => void}
>(({children, onWidthChange}, ref) => {
	const [width, setWidth] = useState(readStoredAsideWidth);
	const [handleHovered, setHandleHovered] = useState(false);
	// Mirrors `width` synchronously: handlePointerMove/handleDragEnd are
	// memoized once (empty deps, so the pointermove/pointerup listeners stay
	// stable across renders) and would otherwise close over a stale `width`
	// from whichever render first attached them.
	const latestWidth = useRef(width);
	const dragStart = useRef<{pointerX: number; width: number} | null>(null);

	// Fires on mount too, not just on drag — so a caller that only reads
	// this (rather than also calling readStoredAsideWidth itself) still sees
	// the persisted width immediately.
	useEffect(() => {
		latestWidth.current = width;
		onWidthChange?.(width);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [width]);

	const handlePointerMove = useCallback((event: PointerEvent) => {
		if (!dragStart.current) return;

		// The panel is on the right edge of the screen; dragging the handle
		// left (negative clientX delta) is what grows it.
		const delta = dragStart.current.pointerX - event.clientX;
		const maxWidth = Math.min(
			MAX_ASIDE_WIDTH,
			window.innerWidth * MAX_ASIDE_WIDTH_RATIO,
		);

		setWidth(
			Math.min(
				maxWidth,
				Math.max(MIN_ASIDE_WIDTH, dragStart.current.width + delta),
			),
		);
	}, []);

	const handleDragEnd = useCallback(() => {
		dragStart.current = null;
		document.removeEventListener('pointermove', handlePointerMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		localStorage.setItem(WIDTH_STORAGE_KEY, String(latestWidth.current));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [handlePointerMove]);

	// A drag left in progress when the panel unmounts (e.g. closing it mid-drag)
	// would otherwise leave the document-level listeners and cursor override
	// permanently attached.
	useEffect(() => {
		return () => {
			if (dragStart.current) handleDragEnd();
		};
	}, [handleDragEnd]);

	const handlePointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
		dragStart.current = {pointerX: event.clientX, width};
		document.addEventListener('pointermove', handlePointerMove);
		document.addEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = 'ew-resize';
		document.body.style.userSelect = 'none';
	};

	return (
		<aside
			ref={ref}
			style={{
				boxSizing: 'border-box',
				width,
				minWidth: width,
				position: 'relative',
				borderLeft: `1px solid ${GUI_THEME.line}`,
				background: GUI_THEME.panel,
				padding: 20,
				fontSize: 12,
				overflow: 'auto',
			}}
		>
			{/* A wide invisible hit area with a thin visible indicator centered in
			    it — the indicator alone (a border's worth of pixels) would be too
			    thin a target to reliably grab.
			    eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
			<div
				onPointerDown={handlePointerDown}
				onMouseEnter={() => setHandleHovered(true)}
				onMouseLeave={() => setHandleHovered(false)}
				title="Drag to resize"
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					bottom: 0,
					width: 12,
					marginLeft: -6,
					cursor: 'ew-resize',
					zIndex: 1,
					display: 'flex',
					justifyContent: 'center',
				}}
			>
				<div
					style={{
						width: 2,
						alignSelf: 'stretch',
						background:
							handleHovered || dragStart.current
								? GUI_THEME.accent
								: 'transparent',
						transition: 'background 120ms ease',
					}}
				/>
			</div>
			{children}
		</aside>
	);
});

Aside.displayName = 'Aside';
