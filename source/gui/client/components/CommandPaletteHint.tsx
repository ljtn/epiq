import {useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// The chord as the platform writes it. A Mac reader shown `Ctrl` reaches for
// the wrong key, and the pill exists to teach the shortcut — getting it wrong
// is worse than not showing one.
const isApple = (): boolean =>
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.userAgent);

// One key, drawn as a key. Two caps side by side rather than one `⌘K` run: the
// glyph and the letter are separate presses, and set solid they read as a
// single strange word.
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

/**
 * The affordance that says the palette exists.
 *
 * A shortcut nobody can discover is a shortcut nobody uses, so this sits in the
 * topbar the way a docs site puts its search chord there. Clickable as well as
 * readable: the point is to be found by somebody who does not yet know the key.
 */
export const CommandPaletteHint = ({onOpen}: {onOpen: () => void}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			data-testid="command-palette-hint"
			onClick={onOpen}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			title="Open the command palette"
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
			<span style={{display: 'inline-flex', alignItems: 'center', gap: 3}}>
				<Key>{isApple() ? '⌘' : 'Ctrl'}</Key>
				<Key>K</Key>
			</span>
			commands
		</button>
	);
};
