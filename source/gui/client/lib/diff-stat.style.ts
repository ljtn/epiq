import {TEXT} from './gui-theme';

/**
 * How a diff stat is set: two figures, then a bar. `stat` beside a commit,
 * `card` on the board in the ref's size with a hairline bar.
 */
export type DiffStatMetrics = {
	barWidth: number;
	barHeight: number;
	gap: number;
	fontSize: number;
	// Held back on the board so the titles lead; full on hover.
	opacity: number;
	// The bar filled by the size of the change on a fixed logarithmic scale,
	// the same for every ticket, so one huge change never shrinks the rest.
	sizedFill?: boolean;
};

// Lines changed that fill a sized bar: a line is a tenth of it, ten about a
// third, a hundred two thirds.
const FULL_FILL_LINES = 1000;

export const diffFill = (lines: number): number =>
	Math.min(1, Math.log10(1 + lines) / Math.log10(1 + FULL_FILL_LINES));

export type DiffStatVariant = 'stat' | 'card' | 'row';

export const DIFF_STAT_METRICS: Record<DiffStatVariant, DiffStatMetrics> = {
	stat: {barWidth: 32, barHeight: 3, gap: 6, fontSize: TEXT.meta, opacity: 1},
	card: {
		barWidth: 24,
		barHeight: 1,
		gap: 5,
		fontSize: TEXT.label,
		opacity: 0.45,
		sizedFill: true,
	},
	// A dense card's: the figures a size under the ref's, then the bar, as
	// long as the change.
	row: {
		barWidth: 40,
		barHeight: 2,
		gap: 4,
		fontSize: 9,
		opacity: 0.45,
		sizedFill: true,
	},
};

// Between the ref and the stat after it: wider than the stat's own gaps, so the
// two read as two things rather than one run of figures.
export const CARD_DIFF_GAP = 10;
