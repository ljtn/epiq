// The settings panel's vocabulary, shared by the sections it is built from.
//
// Here rather than beside any one of them because the panel's whole claim is
// that it is one surface: a heading, a row and a button that each section
// wrote for itself would read as three panels stacked in a drawer.
//
// Set in the prose face: the panel is about the system, not the board's
// work, and that face is what says so. Sizes are the prose scale, a step up
// from the mono UI's so the two read at one visual size.

import {GUI_THEME, TEXT} from './gui-theme';

/** One section label, as quiet as a label can be and still divide. */
export const SECTION_LABEL: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.meta,
	fontWeight: 600,
	textTransform: 'uppercase',
	letterSpacing: '0.08em',
};

/** A label with the gap above it that separates it from the group before. */
export const SECTION_HEADING: React.CSSProperties = {
	...SECTION_LABEL,
	paddingTop: 18,
	paddingBottom: 6,
};

/**
 * The note under something: what git does with an address, why a toggle will
 * not take effect, how many commits a figure counts. Absent where there is
 * nothing to say.
 */
export const META: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.ui,
	marginTop: 3,
	lineHeight: 1.5,
};

// The row's corner, one step past the buttons' 6: a card is a bigger thing.
export const CARD_RADIUS = 8;

/**
 * The ground a section stands on: one card per section, raised a step off
 * the panel. Everything inside it is flat, rows divided by rules, so a card
 * never holds a card.
 */
export const CARD: React.CSSProperties = {
	background: GUI_THEME.panel2,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: CARD_RADIUS,
};

/** One row of a section: a thing on the left, what can be done to it right. */
export const ROW: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 12,
	padding: '10px 0',
	borderBottom: `1px solid ${GUI_THEME.line}`,
};
