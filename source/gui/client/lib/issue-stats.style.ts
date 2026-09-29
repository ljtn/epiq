// The Stats tab's vocabulary: a number, what it is, and — under it, quietly —
// what it was worked out from.
//
// The hierarchy is the whole design. A stat is read at a glance or not at all,
// so the figure carries the weight and everything supporting it is deliberately
// small: the label a hair above legible, the working smaller still. Nothing on
// the tab is allowed to be a bare figure, but nor is a figure allowed to be
// crowded by its own footnotes.

import {GUI_THEME} from './gui-theme';
import {menuBlueGrey} from './select-style';

// One size for every stat, so a row of them is a row of equal squares.
export const STAT_SIZE = 116;
const STAT_GAP = 16;

// How many squares fit across a width.
export const statsAcross = (width: number): number =>
	Math.max(1, Math.floor((width + STAT_GAP) / (STAT_SIZE + STAT_GAP)));

// All in one row where they fit. Four that do not go two by two rather than
// three and one: one stat alone on a second row reads as a mistake.
export const statGrid = (
	count: number,
	across: number,
): React.CSSProperties => {
	const columns =
		count <= across ? count : count === 4 && across >= 2 ? 2 : across;

	return {
		display: 'grid',
		gridTemplateColumns: `repeat(${columns}, ${STAT_SIZE}px)`,
		gap: STAT_GAP,
		marginTop: 14,
	};
};

export const STAT_HOVER_BACKGROUND = menuBlueGrey(0.05);

// Three rows with the figure in the middle one, so it sits at the square's
// centre whatever is written under it.
export const STAT_CELL: React.CSSProperties = {
	display: 'grid',
	gridTemplateRows: 'minmax(0, 1fr) auto minmax(0, 1fr)',
	justifyItems: 'center',
	textAlign: 'center',
	minWidth: 0,
	aspectRatio: '1 / 1',
	boxSizing: 'border-box',
	// The menus' blue-grey, faint; the pointer deepens it (STAT_HOVER_BACKGROUND).
	padding: '6px 4px',
	background: menuBlueGrey(0.02),
	transition: 'background 120ms ease',
};

// A figure's size, shrunk for one too long to fit its square at full size: a
// monospace digit is about 0.62em wide.
export const statValueSize = (value: string): number =>
	Math.min(38, Math.floor((STAT_SIZE - 16) / (0.62 * value.length)));

export const STAT_VALUE: React.CSSProperties = {
	color: GUI_THEME.primary,
	fontSize: 38,
	lineHeight: 1,
	// Tabular-ish spacing: a column of figures that shifts as it updates reads
	// as movement rather than as a number.
	letterSpacing: '-0.01em',
};

// The label and note, under the figure in the bottom row.
export const STAT_CAPTION: React.CSSProperties = {
	gridRow: 3,
	alignSelf: 'start',
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: 4,
	paddingTop: 10,
	minWidth: 0,
};

export const STAT_LABEL: React.CSSProperties = {
	color: GUI_THEME.secondary,
	fontSize: 8,
	textTransform: 'uppercase',
	letterSpacing: '0.1em',
};

export const STAT_NOTE: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: 10,
	lineHeight: 1.35,
};

// A fact with nowhere to go: one line, no number, no decoration.
export const LINE: React.CSSProperties = {
	color: GUI_THEME.secondary,
	fontSize: 11,
	marginTop: 12,
};

export const ROW: React.CSSProperties = {
	display: 'flex',
	justifyContent: 'space-between',
	alignItems: 'baseline',
	gap: 12,
	padding: '5px 0',
	borderBottom: `1px solid ${GUI_THEME.line}`,
	fontSize: 12,
};

export const percent = (value: number): string => `${Math.round(value * 100)}%`;

// Whole days, and never "0": a ticket filed this morning has been open for
// less than a day, which is a different statement from none at all.
export const inDays = (ms: number): string => {
	const days = Math.floor(ms / 86_400_000);

	return days < 1 ? '<1' : String(days);
};

// Only ever the last two segments: the full path is a paragraph in a column
// this narrow, and the tail is what identifies a file to somebody who knows
// the repo. The whole path rides along as a title attribute.
export const shortPath = (path: string): string => {
	const parts = path.split('/');

	return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
};

/**
 * The categorical series, in fixed order — slot 1 for the biggest share, and
 * never cycled: a sixth language folds into "Other" rather than reusing a hue.
 *
 * Validated against this panel's own surface (#11141b) rather than assumed:
 * lightness band, chroma floor, adjacent-pair separation under protanopia and
 * tritanopia, the normal-vision floor, and contrast all pass. The theme's own
 * accents do not — they sit at one lightness, and #ffd479 against #8ce99a is
 * ΔE 3.8 under protanopia, which is the same colour to a good many readers.
 */
export const SERIES = [
	'#3987e5',
	'#d95926',
	'#199e70',
	'#c98500',
	'#d55181',
] as const;

// Everything past the fifth language, and the unfilled half of a proportion
// bar. Neutral on purpose: it is the absence of a series, not a series.
export const SERIES_REST = GUI_THEME.dim2;

export const seriesColor = (index: number): string =>
	SERIES[index] ?? SERIES_REST;

/**
 * What a comment is, wherever one is drawn: the yellow the diff paints comment
 * lines and the yellow the comment bar fills with.
 *
 * Defined here rather than beside the diff theme so both sides read one value
 * — a bar that disagreed with the file it describes would be worse than no bar.
 * Bright on purpose: 14.5:1 against the code background, and still 12.2:1 on
 * the green of an added row.
 */
export const COMMENT_YELLOW = '#ffe066';
