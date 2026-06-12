import React, {ElementType, PropsWithChildren, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

type PanelProps<T extends ElementType> = PropsWithChildren<{
	as?: T;
	active?: boolean;
	borderColor?: string;
	glowColor?: string;
	glowOpacity?: number;
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
	borderRadius = 12,
	style,
	...props
}: PanelProps<T>) => {
	const Component = as ?? 'div';
	const [mouse, setMouse] = useState({x: 0, y: 0});
	const [hovered, setHovered] = useState(false);

	return (
		<Component
			{...props}
			onMouseMove={event => {
				const rect = event.currentTarget.getBoundingClientRect();

				setMouse({
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
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
				style={{
					position: 'absolute',
					inset: 0,
					borderRadius,
					padding: 1,
					pointerEvents: 'none',
					opacity: hovered || active ? glowOpacity : 0,
					background: `radial-gradient(
						200px circle at ${mouse.x}px ${mouse.y}px,
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

			<div
				style={{
					position: 'relative',
					zIndex: 1,
					height: '100%',
				}}
			>
				{children}
			</div>
		</Component>
	);
};
