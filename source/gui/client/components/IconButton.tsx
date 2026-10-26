// The one icon-only button: a 24px square, transparent until hovered, lit
// when pressed. Every icon control is one.

import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {useFocusLift} from '../lib/use-focus-lift';

export const ICON_BUTTON_SIZE = 24;
// The glyph inside the square: what every icon here is drawn at.
export const ICON_SIZE = 14;

export const IconButton = ({
	title,
	pressed,
	disabled = false,
	testId,
	onClick,
	children,
	label,
	tone = 'quiet',
	...rest
}: {
	// The tooltip, and the accessible name unless aria-label sets one; a nested
	// button doesn't lend its name to its parent's.
	title: string;
	// A control that is on or off. Absent on one that only acts.
	pressed?: boolean;
	disabled?: boolean;
	testId?: string;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
	// A figure after the icon — a count — which widens the square into a
	// short pill of the same height and look.
	label?: string;
	/**
	 * How it shows being on. `quiet`: the hover ground and accent. `solid`: an
	 * accent fill, for the live control read from across the room.
	 */
	tone?: 'quiet' | 'solid';
} & Pick<
	React.ButtonHTMLAttributes<HTMLButtonElement>,
	'aria-label' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'onBlur'
>) => {
	const [hovered, setHovered] = useState(false);
	const {focused, focusProps} = useFocusLift<HTMLButtonElement>({
		onBlur: rest.onBlur,
	});
	const lit = pressed === true || ((hovered || focused) && !disabled);
	const filled = tone === 'solid' && pressed === true;

	return (
		<button
			type="button"
			title={title}
			aria-label={rest['aria-label']}
			aria-pressed={pressed}
			aria-haspopup={rest['aria-haspopup']}
			aria-expanded={rest['aria-expanded']}
			aria-controls={rest['aria-controls']}
			{...focusProps}
			data-testid={testId}
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 4,
				width: label === undefined ? ICON_BUTTON_SIZE : undefined,
				height: ICON_BUTTON_SIZE,
				flexShrink: 0,
				padding: label === undefined ? (filled ? 1 : 0) : '0 6px 0 5px',
				// A fill a pixel in from the box's edge: a solid square at the full
				// size reads larger than the bare icons beside it.
				backgroundClip: filled ? 'content-box' : undefined,
				// The colour alone: the `background` shorthand would reset the clip.
				backgroundColor: filled
					? GUI_THEME.accent
					: lit
					? GUI_THEME.hover
					: 'transparent',
				border: 'none',
				outline: 'none',
				borderRadius: 4,
				color: filled
					? GUI_THEME.panel
					: lit
					? GUI_THEME.accent
					: GUI_THEME.dim,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				fontFamily: 'inherit',
				fontSize: ICON_SIZE,
				lineHeight: 1,
				transition: 'color 120ms ease, background 120ms ease',
			}}
		>
			{children}
			{label !== undefined && (
				<span
					style={{
						fontSize: filled ? 10 : 11,
						fontWeight: filled ? 700 : undefined,
						letterSpacing: filled ? 0.6 : undefined,
						fontVariantNumeric: 'tabular-nums',
					}}
				>
					{label}
				</span>
			)}
		</button>
	);
};
