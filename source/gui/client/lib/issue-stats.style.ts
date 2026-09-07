// The Stats tab's vocabulary: a number, what it is, and — under it, quietly —
// what it was worked out from.
//
// The hierarchy is the whole design. A stat is read at a glance or not at all,
// so the figure carries the weight and everything supporting it is deliberately
// small: the label a hair above legible, the working smaller still. Nothing on
// the tab is allowed to be a bare figure, but nor is a figure allowed to be
// crowded by its own footnotes.

import {GUI_THEME} from './gui-theme';

export const STAT_GRID: React.CSSProperties = {
	display: 'grid',
	// Narrow enough that four stats still sit on one row in the panel at its
	// default width — one of four wrapping onto a line of its own reads as a
	// mistake rather than as a layout. Labels wrap instead, which reads fine.
	gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))',
	gap: 16,
	marginTop: 14,
};

export const STAT_CELL: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	textAlign: 'center',
	gap: 3,
	minWidth: 0,
};

export const STAT_VALUE: React.CSSProperties = {
	color: GUI_THEME.primary,
	fontSize: 30,
	lineHeight: 1,
	// Tabular-ish spacing: a column of figures that shifts as it updates reads
	// as movement rather than as a number.
	letterSpacing: '-0.01em',
};

export const STAT_LABEL: React.CSSProperties = {
	color: GUI_THEME.secondary,
	fontSize: 9,
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

export const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? '' : 's'}`;

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
