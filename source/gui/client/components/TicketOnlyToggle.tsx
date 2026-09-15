// The timeline narrowed to the ticket on screen — its own stretch, and its
// events only. Switched here, in the ticket's own panel, rather than on the
// scrubber bar: the bar has no way to say which ticket it would narrow to,
// and the panel is that ticket.

import {IconButton, ICON_SIZE} from './IconButton';
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
	<IconButton
		testId="ticket-only"
		pressed={narrowed}
		disabled={disabled}
		title={
			narrowed && capped
				? 'Too many events to single out — show all'
				: narrowed
				? 'Show the whole timeline'
				: 'Narrow log and timeline to ticket'
		}
		onClick={() => onChange(!narrowed)}
	>
		<IconTimeline size={ICON_SIZE} />
	</IconButton>
);
