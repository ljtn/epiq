import {GUI_THEME} from '../lib/gui-theme';
import {IconMaximize} from './IconMaximize';
import {IconMinimize} from './IconMinimize';

// Icon-only, matching CopyShaButton's own footprint — a plain-text label
// ("Fullscreen"/"Collapse") would sit oddly next to a button with no label.
export const FullscreenToggleButton = ({
	isFullscreen,
	onClick,
}: {
	isFullscreen: boolean;
	onClick: () => void;
}) => (
	<button
		type="button"
		title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		onClick={onClick}
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			flexShrink: 0,
			background: 'transparent',
			border: 'none',
			padding: 4,
			borderRadius: 4,
			cursor: 'pointer',
			color: GUI_THEME.dim,
			transition: 'color 120ms ease, background 120ms ease',
		}}
		onMouseEnter={event => {
			event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
			event.currentTarget.style.color = GUI_THEME.accent;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = 'transparent';
			event.currentTarget.style.color = GUI_THEME.dim;
		}}
	>
		{isFullscreen ? <IconMinimize size={12} /> : <IconMaximize size={12} />}
	</button>
);
