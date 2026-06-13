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
	variant?: 'default' | 'ghost' | 'chip' | 'primary';
}) => {
	const [hovered, setHovered] = useState(false);

	const isPrimary = variant === 'primary';

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
				background: isPrimary
					? hovered
						? 'rgb(41, 44, 57)'
						: GUI_THEME.tertiary
					: hovered
					? 'rgba(255,255,255,0.04)'
					: 'transparent',
				color: GUI_THEME.secondary,
				border: isPrimary
					? `none`
					: variant === 'ghost' && !hovered
					? '1px solid transparent'
					: `1px solid ${hovered ? GUI_THEME.secondary : GUI_THEME.line}`,
				borderRadius: variant === 'chip' ? 999 : 6,
				cursor: props.disabled ? 'default' : 'pointer',
				padding:
					variant === 'ghost' ? '3px 6px' : isPrimary ? '6px 12px' : '5px 9px',
				fontFamily: 'inherit',
				fontSize: 12,
				fontWeight: isPrimary ? 600 : 400,
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
