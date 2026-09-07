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
	// Narrow enough that three stats still sit on one row in the panel at its
	// default width — wrapping one of three onto a line of its own reads as a
	// mistake rather than as a layout.
	gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
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
