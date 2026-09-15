// The timeline narrowed to the ticket on screen — its own stretch, and its
// events only. Switched here, in the ticket's own panel, rather than on the
// scrubber bar: the bar has no way to say which ticket it would narrow to,
// and the panel is that ticket. Icon-only, the footprint of the fullscreen
// and dock buttons beside it.

import {GUI_THEME} from '../lib/gui-theme';
import {IconTimeline} from './IconTimeline';

export const TicketOnlyToggle = ({
	narrowed,
	capped,
	disabled,
	onChange,
}: {
	narrowed: boolean;
	// The ticket's stretch came back from the server as counts alone, naming
	// no events: the narrowing holds the window but cannot pick its events
	// out, and the title says so rather than the chart quietly lying.
	capped: boolean;
	// Offline the narrowing can still be let go of, just not taken up: the
	// window it hands back is one the chart already has.
	disabled: boolean;
	onChange: (next: boolean) => void;
}) => (
	<button
		type="button"
		data-testid="ticket-only"
		aria-pressed={narrowed}
		disabled={disabled}
		title={
			narrowed && capped
				? 'Too many events in this stretch to tell which are the ticket\u2019s — show the whole window again'
				: narrowed
				? 'Show the whole window again'
				: 'Narrow the timeline to this ticket: the stretch it has existed for, and only its events'
		}
		onClick={() => onChange(!narrowed)}
		style={{
			display: 'inline-flex',
			alignItems: 'center',
			flexShrink: 0,
			background: narrowed ? GUI_THEME.hover : 'transparent',
			border: 'none',
			padding: 4,
			borderRadius: 4,
			cursor: disabled ? 'default' : 'pointer',
			color: narrowed ? GUI_THEME.accent : GUI_THEME.dim,
			opacity: disabled ? 0.4 : 1,
			transition: 'color 120ms ease, background 120ms ease',
		}}
		onMouseEnter={event => {
			if (disabled) return;
			event.currentTarget.style.background = GUI_THEME.hover;
			event.currentTarget.style.color = GUI_THEME.accent;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = narrowed
				? GUI_THEME.hover
				: 'transparent';
			event.currentTarget.style.color = narrowed
				? GUI_THEME.accent
				: GUI_THEME.dim;
		}}
	>
		<IconTimeline size={12} />
	</button>
);
