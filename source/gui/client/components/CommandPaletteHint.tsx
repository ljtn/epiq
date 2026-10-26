import {useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// The chord as the platform writes it.
const isApple = (): boolean =>
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.userAgent);

// Two caps, since the modifier and the letter are separate presses.
const Key = ({children}: {children: string}) => (
	<kbd
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			minWidth: 18,
			height: 18,
			padding: '0 4px',
			boxSizing: 'border-box',
			borderRadius: 4,
			background: GUI_THEME.panel2,
			border: `1px solid ${GUI_THEME.line}`,
			color: GUI_THEME.secondary,
			font: 'inherit',
			fontSize: TEXT.label,
			lineHeight: 1,
		}}
	>
		{children}
	</kbd>
);

/** The topbar pill that shows the palette's chord and opens it. */
export const CommandPaletteHint = ({onOpen}: {onOpen: () => void}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			data-testid="command-palette-hint"
			onClick={onOpen}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			aria-label="Open the command palette"
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 7,
				// Only the keys wear a box: a bordered pill around bordered caps is
				// two frames deep for one control.
				background: hovered ? GUI_THEME.hover : 'transparent',
				border: 'none',
				borderRadius: 6,
				padding: '3px 6px',
				color: GUI_THEME.dim2,
				fontSize: TEXT.label,
				fontFamily: 'inherit',
				cursor: 'pointer',
				whiteSpace: 'nowrap',
			}}
		>
			{/* The name, then its keys, as a menu sets an item and its shortcut. */}
			Commands
			<span style={{display: 'inline-flex', alignItems: 'center', gap: 3}}>
				<Key>{isApple() ? '⌘' : 'Ctrl'}</Key>
				<Key>K</Key>
			</span>
		</button>
	);
};
