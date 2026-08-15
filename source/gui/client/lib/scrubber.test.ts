import {describe, expect, it} from 'vitest';
import {GuiCommitEntry, GuiEventTimeline} from './gui-state.model';
import {
	bucketCommitStats,
	bucketCountForSpan,
	bucketIssueCounts,
	buildAxis,
	chooseSegmentUnit,
	dotAppearAnimation,
	dotExitAnimation,
	DOT_EXIT_TOTAL_MS,
	formatPeriodLabel,
	getPeriodRange,
	hourFractionForTime,
	isScope,
	populatedRange,
	SCRUBBER_KEYFRAMES,
	segmentAt,
} from './scrubber';

const DAY = 24 * 60 * 60 * 1000;

const commit = (time: number, linesChanged = 1): GuiCommitEntry => ({
	sha: `sha-${time}`,
	time,
	author: 'a',
	subject: 's',
	linesChanged,
});

const timeline = (
	buckets: {t: number; count: number}[],
	bounds?: {earliest: number; latest: number},
): GuiEventTimeline => ({
	bucketMs: DAY,
	buckets,
	earliest: bounds?.earliest ?? buckets[0]?.t ?? 0,
	latest: bounds?.latest ?? buckets[buckets.length - 1]?.t ?? 0,
});

describe('bucketCountForSpan', () => {
	it('stays inside its floor and ceiling', () => {
		expect(bucketCountForSpan(1)).toBeGreaterThanOrEqual(60);
		expect(bucketCountForSpan(50 * 365 * DAY)).toBeLessThanOrEqual(900);
	});

	it('grows sub-linearly, so ten times the span is not ten times the bars', () => {
		const week = bucketCountForSpan(7 * DAY);
		const tenWeeks = bucketCountForSpan(70 * DAY);

		expect(tenWeeks).toBeGreaterThan(week);
		expect(tenWeeks).toBeLessThan(week * 10);
	});
});

describe('buildAxis', () => {
	it('spans both series, not whichever one is longer', () => {
		const axis = buildAxis(
			timeline([{t: 500, count: 1}], {
				earliest: 500,
				latest: 900,
			}),
			[commit(100), commit(400)],
		);

		expect(axis.earliest).toBe(100);
		expect(axis.latest).toBe(900);
	});

	it('falls back to now when both series are empty', () => {
		const axis = buildAxis(null, [], 1_000);

		expect(axis.earliest).toBe(1_000);
		expect(axis.latest).toBe(1_000);
		// Never zero, or every fraction would divide by it.
		expect(axis.span).toBe(1);
	});

	// With no timeline the axis still runs to now, so `now` is pinned here.
	const tenDayAxis = () =>
		buildAxis(null, [commit(0), commit(10 * DAY)], 10 * DAY);

	it('maps the window ends to 0 and 1 and clamps beyond them', () => {
		const axis = tenDayAxis();

		expect(axis.fractionForTime(0)).toBe(0);
		expect(axis.fractionForTime(10 * DAY)).toBe(1);
		expect(axis.fractionForTime(-DAY)).toBe(0);
		expect(axis.fractionForTime(99 * DAY)).toBe(1);
	});

	it('round-trips a fraction back to a time', () => {
		const axis = tenDayAxis();

		expect(axis.fractionToTime(0)).toBe(0);
		expect(axis.fractionToTime(1)).toBe(10 * DAY);
	});

	it('keeps every bucket index inside the array it indexes', () => {
		const axis = tenDayAxis();

		expect(axis.bucketIndexForTime(-DAY)).toBe(0);
		expect(axis.bucketIndexForTime(99 * DAY)).toBe(axis.bucketCount - 1);
	});
});

describe('bucketIssueCounts', () => {
	it('sums the sparse server buckets into the display slots', () => {
		const axis = buildAxis(null, [commit(0), commit(10 * DAY)], 10 * DAY);
		const counts = bucketIssueCounts(
			axis,
			timeline([
				{t: 0, count: 2},
				{t: 1, count: 3},
				{t: 10 * DAY, count: 5},
			]),
		);

		expect(counts).toHaveLength(axis.bucketCount);
		// The first two land in the same slot; nothing is dropped.
		expect(counts[0]).toBe(5);
		expect(counts[axis.bucketCount - 1]).toBe(5);
		expect(counts.reduce((sum, count) => sum + count, 0)).toBe(10);
	});

	it('is all zeroes with no timeline', () => {
		const axis = buildAxis(null, [commit(0), commit(10 * DAY)], 10 * DAY);

		expect(bucketIssueCounts(axis, null).every(count => count === 0)).toBe(
			true,
		);
	});
});

describe('bucketCommitStats', () => {
	it('accumulates count and lines per bucket', () => {
		const entries = [commit(0, 10), commit(0, 5), commit(10 * DAY, 1)];
		const axis = buildAxis(null, entries, 10 * DAY);
		const stats = bucketCommitStats(axis, entries);

		expect(stats.get(0)).toEqual({count: 2, linesChanged: 15});
		expect(stats.get(axis.bucketCount - 1)).toEqual({
			count: 1,
			linesChanged: 1,
		});
	});
});

describe('populatedRange', () => {
	it('is the first and last drawn bar', () => {
		expect(
			populatedRange([
				{index: 4, intensity: 1},
				{index: 9, intensity: 1},
				{index: 6, intensity: 1},
			]),
		).toEqual([4, 9]);
	});

	it('collapses to zero when nothing is drawn', () => {
		expect(populatedRange([])).toEqual([0, 0]);
	});
});

describe('chooseSegmentUnit', () => {
	it('picks the finest unit that fits inside the segment budget', () => {
		expect(chooseSegmentUnit(7 * DAY)).toBe('day');
		expect(chooseSegmentUnit(120 * DAY)).toBe('week');
		expect(chooseSegmentUnit(2 * 365 * DAY)).toBe('month');
		expect(chooseSegmentUnit(50 * 365 * DAY)).toBe('year');
	});
});

describe('segmentAt', () => {
	it('snaps a day to local midnight and ends a day later', () => {
		const {start, end, label} = segmentAt(
			new Date(2026, 7, 16, 13, 30).getTime(),
			'day',
		);

		expect(new Date(start).getHours()).toBe(0);
		expect(new Date(end).getTime() - start).toBe(DAY);
		expect(label).toBe('Sun 16 Aug');
	});

	it('snaps a week back to Monday', () => {
		// 2026-08-16 is a Sunday, so its week starts on the 10th.
		const {start, label} = segmentAt(
			new Date(2026, 7, 16, 13, 30).getTime(),
			'week',
		);

		expect(new Date(start).getDate()).toBe(10);
		expect(label).toBe('10–16 Aug');
	});

	it('names a week that straddles two months with both', () => {
		const {label} = segmentAt(new Date(2026, 6, 30).getTime(), 'week');

		expect(label).toBe('27 Jul – 2 Aug');
	});

	it('snaps a month and a year to their first day', () => {
		expect(segmentAt(new Date(2026, 7, 16).getTime(), 'month').label).toBe(
			'Aug 2026',
		);
		expect(segmentAt(new Date(2026, 7, 16).getTime(), 'year').label).toBe(
			'2026',
		);
	});
});

describe('hourFractionForTime', () => {
	it('runs from 0 at midnight to just under 1 at the last minute', () => {
		expect(hourFractionForTime(new Date(2026, 7, 16, 0, 0).getTime())).toBe(0);
		expect(hourFractionForTime(new Date(2026, 7, 16, 12, 0).getTime())).toBe(
			0.5,
		);
		expect(
			hourFractionForTime(new Date(2026, 7, 16, 23, 59).getTime()),
		).toBeLessThan(1);
	});
});

describe('dot animations', () => {
	const delayOf = (animation: string) => {
		const delay = /ease-(?:in|out) (\d+)ms/.exec(animation)?.[1];
		if (delay === undefined) throw new Error(`no delay in "${animation}"`);

		return Number(delay);
	};

	// Spread over enough keys that the sort below is not a coincidence.
	const keys = Array.from({length: 40}, (_, index) => `dot-${index}`);

	it('is stable for a given key, so a re-render never reshuffles', () => {
		expect(dotAppearAnimation('abc')).toBe(dotAppearAnimation('abc'));
		expect(dotExitAnimation('abc')).toBe(dotExitAnimation('abc'));
	});

	it('scatters the appear delays rather than firing them together', () => {
		expect(
			new Set(keys.map(key => delayOf(dotAppearAnimation(key)))).size,
		).toBeGreaterThan(1);
	});

	// Each dot's two delays mirror each other about the scatter window, which is
	// what makes the retraction the exact reverse of the appearance: the later a
	// dot twinkled in, the sooner it starts leaving.
	it('retracts in the exact reverse of the order it appeared', () => {
		const scatterWindowMs = DOT_EXIT_TOTAL_MS - 260;

		for (const key of keys) {
			expect(
				delayOf(dotAppearAnimation(key)) + delayOf(dotExitAnimation(key)),
			).toBe(scatterWindowMs);
		}
	});

	it('sends the last dot in out first', () => {
		const byAppearance = [...keys].sort(
			(a, b) => delayOf(dotAppearAnimation(a)) - delayOf(dotAppearAnimation(b)),
		);
		const first = byAppearance[0]!;
		const last = byAppearance[byAppearance.length - 1]!;

		expect(delayOf(dotExitAnimation(last))).toBeLessThan(
			delayOf(dotExitAnimation(first)),
		);
	});

	// `direction: reverse` on the twinkle would be the obvious way to write this,
	// but Chrome fills the delay with the `from` frame under it, dropping every
	// waiting dot to scale 0 so the series blinks out together.
	it('retracts with its own forward keyframes, holding both ends', () => {
		const exit = dotExitAnimation('abc');

		expect(exit).toContain('epiqScrubberRetract');
		expect(exit).not.toContain('reverse');
		// Without `both` a dot pops back to full size before it unmounts.
		expect(exit).toContain('both');
	});

	it('declares the keyframes it animates', () => {
		expect(SCRUBBER_KEYFRAMES).toContain('@keyframes epiqScrubberRetract');
		expect(SCRUBBER_KEYFRAMES).toContain('@keyframes epiqScrubberTwinkle');
	});

	it('finishes every dot within the advertised total', () => {
		for (const key of keys) {
			// The delay plus the 260ms the twinkle itself runs for.
			expect(delayOf(dotExitAnimation(key)) + 260).toBeLessThanOrEqual(
				DOT_EXIT_TOTAL_MS,
			);
		}
	});
});

describe('isScope', () => {
	it('accepts only the four known scopes', () => {
		expect(isScope('week')).toBe(true);
		expect(isScope('all')).toBe(true);
		expect(isScope('decade')).toBe(false);
		expect(isScope(null)).toBe(false);
	});
});

describe('getPeriodRange', () => {
	it('has no range for all time', () => {
		expect(getPeriodRange('all', 0)).toBeNull();
	});

	it('steps a whole period back per offset, without gaps', () => {
		const current = getPeriodRange('week', 0)!;
		const previous = getPeriodRange('week', 1)!;

		expect(current.end - current.start).toBe(7 * DAY);
		// The older window ends where the newer one begins.
		expect(previous.end).toBeCloseTo(current.start, -3);
	});
});

describe('formatPeriodLabel', () => {
	it('names the live window rather than dating it', () => {
		expect(formatPeriodLabel('week', 0, getPeriodRange('week', 0))).toBe(
			'Last 7 days',
		);
		expect(formatPeriodLabel('all', 0, null)).toBe('All time');
	});

	it('dates any window the user has paged back to', () => {
		expect(
			formatPeriodLabel('week', 1, {
				start: new Date(2026, 7, 3).getTime(),
				end: new Date(2026, 7, 10).getTime(),
			}),
		).toBe('8/3 – 8/10');
	});
});
