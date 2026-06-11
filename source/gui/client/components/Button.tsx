import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Button = ({
	children,
	variant = 'default',
	style,
	onMouseEnter,
	onMouseLeave,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: 'default' | 'ghost' | 'chip';
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			{...props}
			onMouseEnter={event => {
				setHovered(true);
				onMouseEnter?.(event);
			}}
			onMouseLeave={event => {
				setHovered(false);
				onMouseLeave?.(event);
			}}
			style={{
				appearance: 'none',
				WebkitAppearance: 'none',
				background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
				color: GUI_THEME.secondary,
				border:
					variant === 'ghost' && !hovered
						? '1px solid transparent'
						: `1px solid ${hovered ? GUI_THEME.secondary : GUI_THEME.line}`,
				borderRadius: variant === 'chip' ? 999 : 8,
				cursor: props.disabled ? 'default' : 'pointer',
				padding: variant === 'ghost' ? '3px 6px' : '5px 9px',
				fontFamily: 'inherit',
				fontSize: 12,
				lineHeight: 1,
				transition:
					'color 120ms ease, background 120ms ease, border-color 120ms ease',
				outline: 'none',
				opacity: props.disabled ? 0.7 : 1,
				...style,
			}}
		>
			{children}
		</button>
	);
};
