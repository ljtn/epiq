import React, {
	createContext,
	forwardRef,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {AsideDock} from '../lib/aside-dock';
import {GUI_THEME} from '../lib/gui-theme';
import {HOVER_REACH} from './FormPrimitives';
import {scrollGutter} from '../lib/scroll-gutter.style';
import {ResizeHandle} from './ResizeHandle';

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

// Below this width a diff stacks its before/after columns.
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

// No upper bound: the drag clamps against the board row's live height.
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

// Where a panel's FormHeader is portalled, in the band above the pane.
// Null until the band mounts.
export const AsideHeaderSlot = createContext<HTMLDivElement | null>(null);

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
	const [isFullscreen, setIsFullscreen] = useState(false);
	// A callback ref into state rather than a plain ref: the panel below it has
	// to re-render once the band exists so its header can portal into it.
	const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
	// State rather than the ref below: the handle re-renders on its own hover
	// and reads this as a prop, so a drag ending has to reach it as a render.
	const [dragging, setDragging] = useState(false);
	const bottom = dock === 'bottom';

	// The drag handlers are memoized once, so they read sizes from here.
	const latestSize = useRef({width, height});
	// `max` is read when the drag starts: the row's height moves with the scrubber.
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

		// Growing moves toward the middle: left when docked right, up when docked bottom.
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
		setDragging(false);
		document.removeEventListener('pointermove', handlePointerMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		localStorage.setItem(
			wasBottom ? HEIGHT_STORAGE_KEY : WIDTH_STORAGE_KEY,
			String(wasBottom ? latestSize.current.height : latestSize.current.width),
		);
	}, [handlePointerMove]);

	// Detaches the document listeners if the panel unmounts mid-drag.
	useEffect(() => {
		return () => {
			if (dragStart.current) handleDragEnd();
		};
	}, [handleDragEnd]);

	const handlePointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
		// A manual resize leaves fullscreen first.
		if (isFullscreen) setIsFullscreen(false);

		// handle -> aside -> the row holding board and panel: the ceiling for a bottom dock.
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

		setDragging(true);
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

	// Tracks the window width for fullscreen and a bottom dock.
	const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

	useEffect(() => {
		if (!isFullscreen && !bottom) return;

		setWindowWidth(window.innerWidth);
		const onResize = () => setWindowWidth(window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, [isFullscreen, bottom]);

	const effectiveWidth = isFullscreen || bottom ? windowWidth : width;

	// Reports the drawn width (the window's in fullscreen or a bottom dock), on mount
	// too. A layout effect, so the caller re-lays out before paint.
	useLayoutEffect(() => {
		onWidthChange?.(effectiveWidth);
	}, [effectiveWidth]);

	return (
		<aside
			ref={ref}
			style={{
				boxSizing: 'border-box',
				// Fullscreen overlays the row: a window-wide flex item would overflow it.
				...(isFullscreen
					? {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0}
					: bottom
					? {position: 'relative', height, minHeight: height}
					: {position: 'relative', width, minWidth: width}),
				// The border and shadow face the board.
				...(bottom && !isFullscreen
					? {
							borderTop: `1px solid ${GUI_THEME.asideEdge}`,
							boxShadow: '0 -10px 24px rgba(0, 0, 0, 0.45)',
					  }
					: {
							borderLeft: `1px solid ${GUI_THEME.asideEdge}`,
							boxShadow: '-10px 0 24px rgba(0, 0, 0, 0.45)',
					  }),
				background: GUI_THEME.panel,
				// None at the top: the header band below carries the inset that puts
				// it on the line the board's and the log's headers keep.
				padding: `0 ${ASIDE_PADDING}px ${ASIDE_PADDING}px`,
				fontSize: 12,
				// The band and the pane stack, and the pane takes what is left.
				display: 'flex',
				flexDirection: 'column',
				// The pane below scrolls; this only clips the resize handle.
				overflow: 'hidden',
			}}
		>
			<ResizeHandle
				edge={bottom ? 'top' : 'left'}
				active={dragging}
				onPointerDown={handlePointerDown}
			/>
			{/* FormHeader lands here, above the scrolling pane. */}
			<div
				data-testid="aside-header"
				ref={setHeaderSlot}
				style={{flexShrink: 0}}
			/>

			{/* The pane scrolls inside the panel's padding, so nothing shows above what it pins. */}
			<div
				data-testid="aside-pane"
				style={{
					flex: 1,
					minHeight: 0,
					overflow: 'auto',
					...scrollGutter(ASIDE_PADDING),
					// Room on the left for a row's hover ground, which reaches past
					// the text it lights; the pane clips at its own edge.
					marginLeft: -HOVER_REACH,
					paddingLeft: HOVER_REACH,
				}}
			>
				<AsideHeaderSlot.Provider value={headerSlot}>
					{typeof children === 'function'
						? children({isFullscreen, toggleFullscreen})
						: children}
				</AsideHeaderSlot.Provider>
			</div>
		</aside>
	);
});

Aside.displayName = 'Aside';
