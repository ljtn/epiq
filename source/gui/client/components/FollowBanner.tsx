// A board that moves on its own says so, in the middle of the topbar: always
// in view, and taking no room from what is below it. The bar's accent edge is
// drawn by the bar itself while this is shown.

import {GUI_THEME} from '../lib/gui-theme';

export const FollowBanner = () => (
	<div
		data-testid="follow-banner"
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			// The word is the news; the sentence after it is the small print.
			color: GUI_THEME.dim2,
			fontSize: 11,
			letterSpacing: 0.3,
			minWidth: 0,
			whiteSpace: 'nowrap',
			// The board is what is being clicked to get out of this; the notice
			// must never be what catches the click.
			pointerEvents: 'none',
		}}
	>
		<strong style={{color: GUI_THEME.accent, letterSpacing: 0.6}}>LIVE</strong>
		{/* Cut short where the bar is tight; the word before it never is. */}
		<span style={{minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis'}}>
			The board navigates on events. Click anywhere to opt out.
		</span>
	</div>
);
