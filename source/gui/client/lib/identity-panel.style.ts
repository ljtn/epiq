// The identity panel's vocabulary, shared by the sections it is built from.
//
// Here rather than beside any one of them because the panel's whole claim is
// that it is one surface: a heading, a card and a button that each section
// wrote for itself would read as three panels stacked in a popover.

import {CODE_FONT} from './code-text.style';
import {GUI_THEME, TEXT} from './gui-theme';

/** One section heading, as quiet as a heading can be and still divide. */
export const SECTION_LABEL: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.label,
	textTransform: 'uppercase',
	letterSpacing: 0.6,
};

/** A heading with the gap above it that separates it from the section before. */
export const SECTION_HEADING: React.CSSProperties = {
	...SECTION_LABEL,
	paddingTop: 18,
	paddingBottom: 8,
};

/**
 * The note under something: what git does with an address, why a toggle will
 * not take effect, how many commits a figure counts. Absent where there is
 * nothing to say.
 */
export const META: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.meta,
	marginTop: 4,
	lineHeight: 1.5,
};

/** Every button in the panel is the same object, so it reads as one surface. */
export const ACTION: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 4,
	cursor: 'pointer',
	fontFamily: CODE_FONT,
	fontSize: TEXT.meta,
	padding: '3px 8px',
	whiteSpace: 'nowrap',
};

/**
 * The ground a row of the panel stands on.
 *
 * A card rather than a rule between rows: two facts about one thing are one
 * object, and a line between them only says where one stops, where a surface
 * says which parts belong together.
 */
export const CARD: React.CSSProperties = {
	background: GUI_THEME.panel2,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 6,
	padding: '10px 12px',
};
