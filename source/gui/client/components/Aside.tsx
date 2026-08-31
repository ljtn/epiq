import React, {
	forwardRef,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {AsideDock} from '../lib/aside-dock';
import {GUI_THEME} from '../lib/gui-theme';

export const ASIDE_WIDTH = 440;
export const ASIDE_PADDING = 20;
const MIN_ASIDE_WIDTH = 380;
// Clamped against the live window width too (see handlePointerMove) — this is
// just a sane ceiling on an unusually wide monitor.
const MAX_ASIDE_WIDTH = 1400;
const MAX_ASIDE_RATIO = 0.9;

// Docked to the bottom the panel is window-wide, so it needs far less of its
// own axis than a side panel does to be worth opening.
export const ASIDE_HEIGHT = 380;
const MIN_ASIDE_HEIGHT = 160;

// Below this, a diff's before/after columns don't have room to stay legible
// side by side; above it, they do. Exported so DiffPanel picks the same
// split/unified boundary the panel itself resizes around.
export const STACKED_DIFF_WIDTH = 760;

const WIDTH_STORAGE_KEY = 'epiq.aside.width';
// Kept apart from the width on purpose: switching sides and back should give
// you the size you had on that side, which one shared number cannot do.
const HEIGHT_STORAGE_KEY = 'epiq.aside.height';

export const readStoredAsideWidth = (): number => {
	const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));

	return Number.isFinite(stored) &&
		stored >= MIN_ASIDE_WIDTH &&
		stored <= MAX_ASIDE_WIDTH
		? stored
		: ASIDE_WIDTH;
};

// No upper bound here: the ceiling is the board row's live height, which this
// cannot see. The drag clamps against it, so a stored value can only ever be
// one a drag already allowed.
export const readStoredAsideHeight = (): number => {
	const stored = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));

	return Number.isFinite(stored) && stored >= MIN_ASIDE_HEIGHT
		? stored
		: ASIDE_HEIGHT;
};

export type AsideRenderApi = {
	isFullscreen: boolean;
	toggleFullscreen: () => void;
};

export const Aside = forwardRef<
	HTMLElement,
	{
		children: React.ReactNode | ((api: AsideRenderApi) => React.ReactNode);
		onWidthChange?: (width: number) => void;
		dock?: AsideDock;
	}
>(({children, onWidthChange, dock = 'right'}, ref) => {
	const [width, setWidth] = useState(readStoredAsideWidth);
	const [height, setHeight] = useState(readStoredAsideHeight);
	const [handleHovered, setHandleHovered] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const bottom = dock === 'bottom';

	// Mirrors the sizes synchronously: handlePointerMove/handleDragEnd are
	// memoized once (empty deps, so the pointermove/pointerup listeners stay
	// stable across renders) and would otherwise close over a stale size
	// from whichever render first attached them.
	const latestSize = useRef({width, height});
	// `max` is measured once, at the moment the drag starts: the ceiling is the
	// board row, whose height moves when the scrubber collapses, so reading it
	// then is both cheaper and more accurate than any stored figure.
	const dragStart = useRef<{
		pointer: number;
		size: number;
		bottom: boolean;
		max: number;
	} | null>(null);
	// The width to come back to on un-maximizing — not persisted, since
	// fullscreen itself is a transient view toggle, not a stored preference.
	const preFullscreenWidth = useRef<number | null>(null);

	useEffect(() => {
		latestSize.current = {width, height};
	}, [width, height]);

	const handlePointerMove = useCallback((event: PointerEvent) => {
		const start = dragStart.current;
		if (!start) return;

		// The panel is on the far edge either way, so the handle travels toward
		// the middle of the screen to grow it: left when docked right, up when
		// docked bottom. Same sign, different axis.
		const delta = start.bottom
			? start.pointer - event.clientY
			: start.pointer - event.clientX;

		const next = Math.min(
			start.max,
			Math.max(
				start.bottom ? MIN_ASIDE_HEIGHT : MIN_ASIDE_WIDTH,
				start.size + delta,
			),
		);

		if (start.bottom) setHeight(next);
		else setWidth(next);
	}, []);

	const handleDragEnd = useCallback(() => {
		const wasBottom = dragStart.current?.bottom ?? false;
		dragStart.current = null;
		document.removeEventListener('pointermove', handlePointerMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		localStorage.setItem(
			wasBottom ? HEIGHT_STORAGE_KEY : WIDTH_STORAGE_KEY,
			String(wasBottom ? latestSize.current.height : latestSize.current.width),
		);
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
		// A manual resize is a clear signal the user wants a specific size,
		// not the fullscreen one — drop out of fullscreen first so the drag
		// starts from the panel's normal (pre-fullscreen) size.
		if (isFullscreen) setIsFullscreen(false);

		// handle -> aside -> the row holding the board and this panel. That row
		// is exactly the space between the timeline and the bottom of the
		// window, so it is the ceiling for a bottom dock without anyone having
		// to know the header's or the scrubber's height.
		const row = event.currentTarget.parentElement?.parentElement;
		const rowSize = row?.getBoundingClientRect();

		dragStart.current = {
			pointer: bottom ? event.clientY : event.clientX,
			size: bottom ? height : width,
			bottom,
			max: bottom
				? (rowSize?.height ?? window.innerHeight) * MAX_ASIDE_RATIO
				: Math.min(MAX_ASIDE_WIDTH, window.innerWidth * MAX_ASIDE_RATIO),
		};

		document.addEventListener('pointermove', handlePointerMove);
		document.addEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = bottom ? 'ns-resize' : 'ew-resize';
		document.body.style.userSelect = 'none';
	};

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen(prev => {
			if (prev) {
				setWidth(preFullscreenWidth.current ?? readStoredAsideWidth());
				preFullscreenWidth.current = null;
			} else {
				preFullscreenWidth.current = latestSize.current.width;
			}
			return !prev;
		});
	}, []);

	// window.innerWidth is only read at render time, so without this the panel
	// would stay pinned to whatever width the browser happened to be when
	// fullscreen was toggled on, ignoring a resize of the window itself while
	// it's active. Tracked for a bottom dock too, which is window-wide by
	// construction rather than by its own stored size.
	const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

	useEffect(() => {
		if (!isFullscreen && !bottom) return;

		setWindowWidth(window.innerWidth);
		const onResize = () => setWindowWidth(window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, [isFullscreen, bottom]);

	const effectiveWidth = isFullscreen || bottom ? windowWidth : width;

	// Reports the width the panel is actually drawn at — in fullscreen or
	// docked to the bottom the window's, not the stored one — so layout
	// decisions track what is on screen. Fires on mount too, not just on drag,
	// so a caller that only reads this (rather than also calling
	// readStoredAsideWidth itself) sees the persisted width immediately. A
	// layout effect so the caller's re-render lands before the browser paints:
	// a passive effect would let a frame through with the panel at its new
	// width but the content still laid out for the old one.
	useLayoutEffect(() => {
		onWidthChange?.(effectiveWidth);
	}, [effectiveWidth]);

	return (
		<aside
			ref={ref}
			style={{
				boxSizing: 'border-box',
				// Fullscreen overlays the row rather than growing inside it: the
				// board next to it can't shrink below its own padding, so a
				// window-wide flex item would overflow the row and be clipped
				// on the right. Overlaying also leaves the board's scroll alone.
				...(isFullscreen
					? {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0}
					: bottom
					? {position: 'relative', height, minHeight: height}
					: {position: 'relative', width, minWidth: width}),
				// The border faces the board, which is above it in one dock and
				// beside it in the other.
				...(bottom && !isFullscreen
					? {borderTop: `1px solid ${GUI_THEME.line}`}
					: {borderLeft: `1px solid ${GUI_THEME.line}`}),
				background: GUI_THEME.panel,
				padding: ASIDE_PADDING,
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
					zIndex: 1,
					display: 'flex',
					...(bottom
						? {
								top: 0,
								left: 0,
								right: 0,
								height: 12,
								marginTop: -6,
								cursor: 'ns-resize',
								alignItems: 'center',
						  }
						: {
								left: 0,
								top: 0,
								bottom: 0,
								width: 12,
								marginLeft: -6,
								cursor: 'ew-resize',
								justifyContent: 'center',
						  }),
				}}
			>
				<div
					style={{
						...(bottom
							? {height: 2, width: '100%'}
							: {width: 2, alignSelf: 'stretch'}),
						background:
							handleHovered || dragStart.current
								? GUI_THEME.accent
								: 'transparent',
						transition: 'background 120ms ease',
					}}
				/>
			</div>
			{typeof children === 'function'
				? children({isFullscreen, toggleFullscreen})
				: children}
		</aside>
	);
});

Aside.displayName = 'Aside';
