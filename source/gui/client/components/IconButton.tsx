// The one icon-only button. A 24px square, transparent until hovered, when it
// takes the hover ground and the accent; pressed, it keeps both. Every icon
// control — the ticket panel's header, its dock and collapse controls, the
// kebab menus, the close cross — is one of these, so they all hover, light and
// sit alike, at one size.

import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

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
	// Read as the tooltip, and as the accessible name where nothing sets one:
	// only an explicit aria-label is one, so a button nested in another (the
	// copy button in a commit row) does not lend its name to the row's.
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
	 * How loudly it wears being on.
	 *
	 * `quiet` is every icon control on the board: pressed, it keeps the hover
	 * ground and takes the accent, which is enough for a switch among switches.
	 *
	 * `solid` fills with the accent instead and puts the panel's own near-black
	 * on it. For the one control that has to be read from across a room rather
	 * than found among its neighbours — the live half of the transport, which
	 * says the board is moving on its own.
	 */
	tone?: 'quiet' | 'solid';
} & Pick<
	React.ButtonHTMLAttributes<HTMLButtonElement>,
	'aria-label' | 'aria-haspopup' | 'aria-expanded'
>) => {
	const [hovered, setHovered] = useState(false);
	const lit = pressed === true || (hovered && !disabled);
	const filled = tone === 'solid' && pressed === true;

	return (
		<button
			type="button"
			title={title}
			aria-label={rest['aria-label']}
			aria-pressed={pressed}
			aria-haspopup={rest['aria-haspopup']}
			aria-expanded={rest['aria-expanded']}
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
				padding: label === undefined ? 0 : '0 6px 0 5px',
				background: filled
					? GUI_THEME.accent
					: lit
					? GUI_THEME.hover
					: 'transparent',
				border: 'none',
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
