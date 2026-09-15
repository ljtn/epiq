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
} & Pick<
	React.ButtonHTMLAttributes<HTMLButtonElement>,
	'aria-label' | 'aria-haspopup' | 'aria-expanded'
>) => {
	const [hovered, setHovered] = useState(false);
	const lit = pressed === true || (hovered && !disabled);

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
				width: ICON_BUTTON_SIZE,
				height: ICON_BUTTON_SIZE,
				flexShrink: 0,
				padding: 0,
				background: lit ? GUI_THEME.hover : 'transparent',
				border: 'none',
				borderRadius: 4,
				color: lit ? GUI_THEME.accent : GUI_THEME.dim,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				fontFamily: 'inherit',
				fontSize: ICON_SIZE,
				lineHeight: 1,
				transition: 'color 120ms ease, background 120ms ease',
			}}
		>
			{children}
		</button>
	);
};
