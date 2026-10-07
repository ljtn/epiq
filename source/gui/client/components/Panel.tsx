import React, {
	createContext,
	ElementType,
	PropsWithChildren,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

// Roughly one sample per frame at 60Hz, without depending on the frame clock.
const POINTER_SAMPLE_MS = 16;

// The glow on the nearest panel's border, for anything inside it that wants
// to light with it: where the light is, in viewport coordinates, how strong
// it is right now, and the circle and colour it is drawn with.
export type PanelGlow = {
	x: number;
	y: number;
	// 0 to 1, what the border's own glow is multiplied by.
	strength: number;
	radius: number;
	color: string;
};

export const PanelGlowContext = createContext<PanelGlow>({
	x: 0,
	y: 0,
	strength: 0,
	radius: 0,
	color: 'transparent',
});

type PanelProps<T extends ElementType> = PropsWithChildren<{
	as?: T;
	active?: boolean;
	borderColor?: string;
	glowColor?: string;
	glowOpacity?: number;
	glowRadius?: number;
	// How far outside the panel the pointer still lights its border, in px. Omit
	// for the plain behaviour where the glow only appears on hover.
	proximityReach?: number;
	borderRadius?: number;
	style?: React.CSSProperties;
}> &
	Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'children' | 'style'>;

export const Panel = <T extends ElementType = 'div'>({
	as,
	children,
	active = false,
	borderColor = GUI_THEME.line,
	glowColor = GUI_THEME.secondary,
	glowOpacity = 0.25,
	glowRadius = 200,
	proximityReach,
	borderRadius = 12,
	style,
	...props
}: PanelProps<T>) => {
	const Component = as ?? 'div';
	// Relative to the panel, for its own gradient, and in the viewport, for
	// whatever inside it lights with the same glow.
	const [mouse, setMouse] = useState({x: 0, y: 0, clientX: 0, clientY: 0});
	const [hovered, setHovered] = useState(false);
	// 0 beyond `proximityReach`, 1 on the panel, interpolated in between.
	const [proximity, setProximity] = useState(0);
	// Used only to reach its parent for measurement: the panel renders as a
	// generic `as` component, which can't take a typed ref.
	const glowRef = useRef<HTMLDivElement | null>(null);
	const lastMeasuredRef = useRef(0);

	// Tracks the pointer window-wide so a panel lights up as you approach it.
	// Throttled by timestamp, not requestAnimationFrame, which is paused in
	// background tabs and would leave the glow frozen.
	useEffect(() => {
		if (proximityReach === undefined) return;

		const onMove = (event: MouseEvent) => {
			const now = Date.now();
			if (now - lastMeasuredRef.current < POINTER_SAMPLE_MS) return;
			lastMeasuredRef.current = now;

			const panel = glowRef.current?.parentElement;
			if (!panel) return;

			const rect = panel.getBoundingClientRect();
			// Distance from the *edges*, so anywhere inside reads as 0.
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

			setProximity(
				distance >= proximityReach ? 0 : 1 - distance / proximityReach,
			);
			setMouse({
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
				clientX: event.clientX,
				clientY: event.clientY,
			});
		};

		window.addEventListener('mousemove', onMove);

		return () => window.removeEventListener('mousemove', onMove);
	}, [proximityReach]);

	const glowStrength = active
		? 1
		: proximityReach !== undefined
		? proximity
		: hovered
		? 1
		: 0;

	const glow = useMemo<PanelGlow>(
		() => ({
			x: mouse.clientX,
			y: mouse.clientY,
			strength: glowStrength,
			radius: glowRadius,
			color: glowColor,
		}),
		[mouse.clientX, mouse.clientY, glowStrength, glowRadius, glowColor],
	);

	return (
		<Component
			{...props}
			onMouseMove={event => {
				const rect = event.currentTarget.getBoundingClientRect();

				setMouse({
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
					clientX: event.clientX,
					clientY: event.clientY,
				});

				props.onMouseMove?.(event);
			}}
			onMouseEnter={event => {
				setHovered(true);
				props.onMouseEnter?.(event);
			}}
			onMouseLeave={event => {
				setHovered(false);
				props.onMouseLeave?.(event);
			}}
			style={{
				position: 'relative',
				border: `1px solid ${borderColor}`,
				borderRadius,
				overflow: 'hidden',
				...style,
			}}
		>
			<div
				ref={glowRef}
				style={{
					position: 'absolute',
					inset: 0,
					borderRadius,
					padding: 1,
					pointerEvents: 'none',
					opacity: glowStrength * glowOpacity,
					background: `radial-gradient(
						${glowRadius}px circle at ${mouse.x}px ${mouse.y}px,
						${glowColor},
						transparent 100%
					)`,
					mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
					WebkitMask:
						'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
					maskComposite: 'exclude',
					WebkitMaskComposite: 'xor',
					transition: 'opacity 140ms ease',
				}}
			/>

			{/* Positioned so it paints over the glow above (same z level, later in
			    the tree), but with no z-index of its own: that would make the panel
			    a stacking context and trap any popover inside it under positioned
			    content elsewhere on the page. */}
			<div
				style={{
					position: 'relative',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					minHeight: 0,
				}}
			>
				<PanelGlowContext.Provider value={glow}>
					{children}
				</PanelGlowContext.Provider>
			</div>
		</Component>
	);
};
