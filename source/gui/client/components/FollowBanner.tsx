// A board that moves on its own says so.
//
// One rule at the top, where the band meets the chrome above it. Two boxed the
// sentence in and made it a thing in its own right; one reads as the board's
// own edge, which is what it is — at two pixels, since alone it carries the
// weight both rules carried together.
//
// Drawn in the board's own flow rather than over it: a banner that covers a
// lane is a banner that has to be got rid of.

import {GUI_THEME} from '../lib/gui-theme';

// A crest travelling along the rule, once every few seconds. A wave rather than
// a blink: it reads as something passing through, which is what following is,
// where a pulse reads as an alert wanting to be dealt with.
//
// Long and slow on purpose. The band is standing information, not a
// notification — it should be catchable out of the corner of an eye and never
// worth looking at directly. A reader who has asked for less motion gets the
// plain rule.
//
// Mounted with the banner, so it carries its own look rather than depending on
// some other panel being up to define it — the same way the log's styles are.
const FOLLOW_BANNER_STYLES = `
@keyframes epiqFollowSweep {
	from { background-position: 180% 0; }
	to { background-position: -80% 0; }
}

.epiq-follow-rule {
	height: 2px;
	flex-shrink: 0;
	background-color: ${GUI_THEME.accent};
	background-image: linear-gradient(
		90deg,
		transparent 0%,
		transparent 42%,
		rgba(255, 255, 255, 0.55) 50%,
		transparent 58%,
		transparent 100%
	);
	background-size: 260% 100%;
	background-repeat: no-repeat;
	animation: epiqFollowSweep 5s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
	.epiq-follow-rule {
		animation: none;
		background-image: none;
	}
}
`;

export const FollowBanner = () => (
	<div
		data-testid="follow-banner"
		style={{
			display: 'flex',
			flexDirection: 'column',
			// The board is what is being clicked to get out of this; the band must
			// never be what catches the click.
			pointerEvents: 'none',
		}}
	>
		<style>{FOLLOW_BANNER_STYLES}</style>

		<div className="epiq-follow-rule" />

		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 8,
				padding: '6px 12px',
				color: GUI_THEME.primary,
				fontSize: 11,
				letterSpacing: 0.3,
			}}
		>
			<strong style={{color: GUI_THEME.accent, letterSpacing: 0.6}}>
				LIVE
			</strong>
			<span>The board navigates on events. Click anywhere to opt out.</span>
		</div>
	</div>
);
