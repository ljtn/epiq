// A board that moves on its own says so.
//
// A rule rather than a filled band: it has to be unmissable without becoming
// the brightest thing on screen, and what is below it is what the reader came
// for. Drawn in the flow at the top of the window — a banner that covers what
// it describes is a banner that has to be got rid of.

import {GUI_THEME} from '../lib/gui-theme';

export const FollowBanner = () => (
	<div
		data-testid="follow-banner"
		style={{
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 8,
			padding: '6px 12px',
			// One rule, along the very top of the window: nothing is above it, so
			// it is the app's own live edge rather than a seam between two bands.
			// A second rule below boxed the sentence in and made it a thing in its
			// own right.
			//
			// Two pixels, not one: alone it has to carry the weight both rules
			// carried together, and a hairline against a near-black chrome is a
			// seam rather than a statement.
			borderTop: `2px solid ${GUI_THEME.accent}`,
			color: GUI_THEME.primary,
			fontSize: 11,
			letterSpacing: 0.3,
			// The board is what is being clicked to get out of this; the band must
			// never be what catches the click.
			pointerEvents: 'none',
		}}
	>
		<strong style={{color: GUI_THEME.accent, letterSpacing: 0.6}}>LIVE</strong>
		<span>The board navigates on events. Click anywhere to opt out.</span>
	</div>
);
