import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Button = ({
	children,
	variant = 'default',
	tint,
	held = false,
	dense = false,
	style,
	onMouseEnter,
	onMouseLeave,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: 'default' | 'ghost' | 'chip' | 'primary';
	// A hex colour the button *stands for*, rather than one it is painted in: a
	// tag's own colour. The fill and the border take a wash of it, so the name,
	// what it sits on and what encloses it read as one object instead of three.
	// Kept far enough down that it colours the chip without competing with the
	// title above it.
	tint?: string;
	// This one is on and stays on — the tag the board is narrowed to. A step
	// past what the pointer does, so it reads as pressed across a board the
	// pointer is nowhere near, and pressing it again is visibly the way back.
	// Only means anything alongside a `tint`.
	held?: boolean;
	// The same chip, tightened. A panel shows a ticket's tags once and has the
	// room; a card shows them in a column of thirty, where the row of tags is
	// the card's height and every step of padding is paid for down the board.
	dense?: boolean;
}) => {
	const [hovered, setHovered] = useState(false);

	const isPrimary = variant === 'primary';

	// Four steps of the same wash: resting, under the pointer, held, and held
	// under the pointer. The border climbs faster than the fill — it is the edge
	// that says which chip you are on, while the fill stays behind the name.
	const wash = held ? (hovered ? '4d' : '3d') : hovered ? '2b' : '1c';
	const edge = held ? 'ff' : hovered ? '7a' : '3d';

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
				background: tint
					? `${tint}${wash}`
					: isPrimary
					? hovered
						? 'rgb(41, 44, 57)'
						: GUI_THEME.tertiary
					: hovered
					? GUI_THEME.hover
					: 'transparent',
				color: GUI_THEME.secondary,
				border: tint
					? `1px solid ${tint}${edge}`
					: isPrimary
					? `none`
					: variant === 'ghost' && !hovered
					? '1px solid transparent'
					: `1px solid ${hovered ? GUI_THEME.secondary : GUI_THEME.line}`,
				borderRadius: variant === 'chip' ? 999 : 6,
				cursor: props.disabled ? 'default' : 'pointer',
				padding: dense
					? '2px 8px'
					: variant === 'ghost'
					? '3px 6px'
					: isPrimary
					? '6px 12px'
					: '5px 9px',
				fontFamily: 'inherit',
				fontSize: dense ? 11 : 12,
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
