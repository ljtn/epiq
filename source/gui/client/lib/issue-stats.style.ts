// The Stats tab's vocabulary: a stat is a number, a unit and — wherever there
// is one — the thing it should be read against.
//
// Kept out of the component because the rule is the point rather than the
// styling: nothing on that tab is allowed to be a bare figure. A share carries
// its denominator, a comparison carries what it is compared with, and a fact
// nobody could measure says so instead of printing a zero.

import {GUI_THEME} from './gui-theme';

export const STAT_GRID: React.CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
	gap: 12,
	marginTop: 12,
};

export const STAT_VALUE: React.CSSProperties = {
	color: GUI_THEME.primary,
	fontSize: 20,
	lineHeight: 1.1,
};

export const STAT_LABEL: React.CSSProperties = {
	color: GUI_THEME.secondary,
	fontSize: 10,
	textTransform: 'uppercase',
	letterSpacing: '0.08em',
	marginTop: 4,
};

export const STAT_NOTE: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: 11,
	marginTop: 4,
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

/**
 * A share of nothing is not 0% — it is nothing to divide. Every place a
 * percentage is shown has to be able to say so, so the formatting says it once
 * rather than each caller inventing its own dash.
 */
export const shareOf = (part: number, whole: number): string =>
	whole === 0 ? '—' : percent(part / whole);

export const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? '' : 's'}`;

// Coarse on purpose: the exact age of a coverage report is never the point,
// and "3 days ago" is the sentence a reader needs to decide whether to trust
// the number beside it.
export const relativeAge = (at: number, now: number): string => {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));

	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${plural(minutes, 'minute')} ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${plural(hours, 'hour')} ago`;

	return `${plural(Math.round(hours / 24), 'day')} ago`;
};
