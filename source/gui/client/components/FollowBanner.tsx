// A board that moves on its own says so.
//
// Two rules rather than a filled band: it has to be unmissable without becoming
// the brightest thing on screen, and the board below it is what the reader came
// for. Drawn in the board's own flow — a banner that covers a lane is a banner
// that has to be got rid of.

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
			// One rule, at the top, where the band meets the chrome above it. Two
			// boxed the sentence in and made it a thing in its own right; one
			// reads as the board's own edge, which is what it is.
			//
			// Two pixels, not one: alone it has to carry the weight both rules
			// carried together, and a hairline at the top of a dark board is a
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
