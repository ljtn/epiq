import {useState} from 'react';
import {AsideDock} from '../lib/aside-dock';
import {GUI_THEME} from '../lib/gui-theme';
import {IconDockBottom} from './IconDockBottom';
import {IconDockRight} from './IconDockRight';

const DockButton = ({
	label,
	active,
	icon,
	onClick,
}: {
	label: string;
	active: boolean;
	icon: React.ReactNode;
	onClick: () => void;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			title={label}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				flexShrink: 0,
				border: 'none',
				padding: 4,
				borderRadius: 4,
				cursor: 'pointer',
				// The selected side is lit rather than boxed: one accent mark in a
				// row of dim ones says which it is without adding a frame the rest
				// of this header does not have.
				color: active ? GUI_THEME.accent : GUI_THEME.dim,
				background:
					active || hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
				transition: 'color 120ms ease, background 120ms ease',
			}}
		>
			{icon}
		</button>
	);
};

/**
 * Which edge the panel is attached to, as the pair of states rather than a
 * toggle: devtools shows both choices at once, and the one that is lit is the
 * answer to "where is it now" without having to click to find out.
 */
export const DockButtons = ({
	dock,
	onDock,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
}) => (
	<>
		<DockButton
			label="Dock to bottom"
			active={dock === 'bottom'}
			icon={<IconDockBottom size={12} />}
			onClick={() => onDock('bottom')}
		/>
		<DockButton
			label="Dock to right"
			active={dock === 'right'}
			icon={<IconDockRight size={12} />}
			onClick={() => onDock('right')}
		/>
	</>
);
