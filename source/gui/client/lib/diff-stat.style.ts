import {TEXT} from './gui-theme';

/**
 * How a diff stat is set: two figures, and a bar after them where the variant
 * has one. `stat` beside a commit or file, `card` and `row` on the board's
 * cards, in the ref's size.
 */
export type DiffStatMetrics = {
	bar?: {width: number; height: number};
	gap: number;
	fontSize: number;
	// Held back on the board so the titles lead; full on hover.
	opacity: number;
};

export type DiffStatVariant = 'stat' | 'card' | 'row';

export const DIFF_STAT_METRICS: Record<DiffStatVariant, DiffStatMetrics> = {
	stat: {bar: {width: 32, height: 3}, gap: 6, fontSize: TEXT.meta, opacity: 1},
	card: {gap: 5, fontSize: TEXT.label, opacity: 0.45},
	// A dense card's: the figures a size under the ref's.
	row: {gap: 4, fontSize: 9, opacity: 0.45},
};

// Between the ref and the stat after it: wider than the stat's own gaps, so the
// two read as two things rather than one run of figures.
export const CARD_DIFF_GAP = 10;
