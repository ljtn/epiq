// What a select looks like, wherever one is drawn: the trigger you open and
// the popover it drops. The scrubber's series and scope pickers and the
// header's board switcher all wear these, so a select reads as one kind of
// control across the page.

import {GUI_THEME} from './gui-theme';

// A select. Filled rather than outlined, unlike the toggles beside it on the
// scrubber: it is the only control there reporting a colour, and an outline in
// that colour drowned out the text carrying it. The fill also separates a thing
// you open from the things you switch.
export const selectTriggerStyle = (
	color: string,
	disabled: boolean,
): React.CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 6,
	boxSizing: 'border-box',
	background: 'rgba(208, 223, 255, 0.08)',
	// None, but padded as though there were, so it sits at the same height as
	// the bordered toggles on either side.
	border: 'none',
	color: disabled ? GUI_THEME.dim : color,
	borderRadius: 6,
	fontFamily: 'inherit',
	fontSize: 11,
	padding: '5px 7px 5px 9px',
	cursor: disabled ? 'not-allowed' : 'pointer',
	opacity: disabled ? 0.4 : 1,
});

// The label inside a trigger: clipped rather than wrapped. A name long enough
// to overflow is still recognisable from its start, and the open list spells
// it out in full.
export const selectLabelStyle: React.CSSProperties = {
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
};

// Floated rather than in flow: a select sits over whatever it filters, and a
// list that grew the row would shove the very thing being chosen for downward.
export const popoverStyle: React.CSSProperties = {
	position: 'absolute',
	top: '100%',
	left: 0,
	marginTop: 6,
	// Carries the column and its gap itself. Without them the options stack as
	// plain blocks and their radios sit edge to edge.
	display: 'flex',
	flexDirection: 'column',
	gap: 7,
	padding: '10px 14px 10px 10px',
	// Sized for the common case up front, so opening a kind with a list does
	// not visibly widen the panel under the pointer.
	minWidth: 178,
	// Slightly sheer over a blur, so what it covers stays legible beneath it
	// rather than being covered outright.
	background: 'rgba(21, 26, 36, 0.88)',
	backdropFilter: 'blur(12px)',
	WebkitBackdropFilter: 'blur(12px)',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 8,
	boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
	// Above the scrubber's dots and needle, which sit at 1 and 2.
	zIndex: 30,
	whiteSpace: 'nowrap',
};
