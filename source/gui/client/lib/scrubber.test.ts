import {describe, expect, it} from 'vitest';
import {
	GuiCommitEntry,
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from './gui-state.model';
import {
	bucketCommitStats,
	bucketCountForSpan,
	bucketIssueCounts,
	buildAxis,
	buildBoardFilter,
	buildEventDots,
	categoryOf,
	issuePassesBoardFilter,
	identityAxisFor,
	listIdentities,
	soleVisibleIdentity,
	chooseSegmentUnit,
	dotAppearAnimation,
	dotEntranceScale,
	dotExitAnimation,
	dotExitScale,
	DOT_EXIT_TOTAL_MS,
	formatPeriodLabel,
	getPeriodRange,
	hourFractionForTime,
	isScope,
	populatedRange,
	SCOPES,
	SCRUBBER_KEYFRAMES,
	segmentAt,
	windowIssueIds,
	windowNamesIssues,
} from './scrubber';

const DAY = 24 * 60 * 60 * 1000;

const commit = (time: number, linesChanged = 1): GuiCommitEntry => ({
	sha: `sha-${time}`,
	time,
	author: 'a',
	subject: 's',
	linesChanged,
	insertions: linesChanged,
	deletions: 0,
});

const person = (name: string): GuiEventIdentity => ({
	id: `id-${name}`,
	name,
	color: `#${name.length}${name.length}${name.length}fff`.slice(0, 7),
});

const entry = (
	t: number,
	action: string,
	extra: Partial<GuiEventTimelineEntry> = {},
): GuiEventTimelineEntry => ({
	id: `event-${t}-${action}`,
	t,
	action,
	label: action,
	actor: null,
	tag: null,
	assignee: null,
	issue: null,
	...extra,
});

const timeline = (
	buckets: {t: number; count: number}[],
	bounds?: {earliest: number; latest: number},
	events: GuiEventTimelineEntry[] = [],
): GuiEventTimeline => ({
	bucketMs: DAY,
	buckets,
	events,
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

	it('spans the scope, not the stretch of it the events happen to fill', () => {
		// A week-wide window whose events all land in its last hour.
		const weekStart = 100 * DAY;
		const weekEnd = weekStart + 7 * DAY;
		const clustered = weekEnd - 60 * 60 * 1000;

		const axis = buildAxis(
			timeline([{t: clustered, count: 3}], {
				earliest: weekStart,
				latest: weekEnd,
			}),
			[],
			weekEnd,
		);

		expect(axis.earliest).toBe(weekStart);
		expect(axis.latest).toBe(weekEnd);
	});

	it('keeps a past window off the present when there are no commits', () => {
		const start = 100 * DAY;
		const end = 107 * DAY;

		const axis = buildAxis(
			timeline([{t: start, count: 1}], {earliest: start, latest: end}),
			[],
			// "Now" is well past the window being looked at.
			200 * DAY,
		);

		expect(axis.latest).toBe(end);
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

	describe('narrowed to one ticket', () => {
		const events = [
			entry(0, 'add.issue', {issue: 'mine'}),
			entry(DAY, 'edit.title', {issue: 'theirs'}),
			entry(2 * DAY, 'add.issue.comment', {issue: 'mine'}),
			// Board-level: belongs to no ticket at all.
			entry(3 * DAY, 'add.swimlane'),
		];

		const axis = () => buildAxis(null, [commit(0), commit(10 * DAY)], 10 * DAY);

		it('counts only that ticket, board-level events included out', () => {
			const built = axis();
			const counts = bucketIssueCounts(
				built,
				timeline([], {earliest: 0, latest: 10 * DAY}, events),
				'all',
				new Set(),
				'mine',
			);

			expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
		});

		it('counts every ticket when narrowed to none', () => {
			const built = axis();
			const counts = bucketIssueCounts(
				built,
				timeline([], {earliest: 0, latest: 10 * DAY}, events),
			);

			expect(counts.reduce((sum, count) => sum + count, 0)).toBe(4);
		});

		// The cap's fallback is pre-summed across every ticket, so there is
		// nothing left for the filter to act on. The checkbox says so rather
		// than the chart quietly lying.
		it('cannot narrow the bucketed fallback, and does not pretend to', () => {
			const built = axis();
			const counts = bucketIssueCounts(
				built,
				timeline([{t: 0, count: 7}], {earliest: 0, latest: 10 * DAY}),
				'all',
				new Set(),
				'mine',
			);

			expect(counts.reduce((sum, count) => sum + count, 0)).toBe(7);
		});
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
		// A day's span would otherwise land on one day-wide segment covering the
		// whole track, leaving the hover highlight with nothing to say.
		expect(chooseSegmentUnit(DAY)).toBe('hour');
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

	it('dates a zoomed window even at its most recent, which no scope names', () => {
		expect(
			formatPeriodLabel('week', 0, {
				start: new Date(2026, 7, 3).getTime(),
				end: new Date(2026, 7, 10).getTime(),
			}),
		).toBe('Last 7 days');

		expect(
			formatPeriodLabel(
				'week',
				0,
				{
					start: new Date(2026, 7, 3).getTime(),
					end: new Date(2026, 7, 10).getTime(),
				},
				true,
			),
		).toBe('8/3 – 8/10');
	});

	it('gives the clock rather than two identical dates inside one day', () => {
		expect(
			formatPeriodLabel(
				'hour',
				0,
				{
					start: new Date(2026, 7, 3, 9, 15).getTime(),
					end: new Date(2026, 7, 3, 11, 45).getTime(),
				},
				true,
			),
		).toBe('09:15 – 11:45');
	});
});

describe('buildEventDots', () => {
	it('draws one dot per event, not one per bucket', () => {
		// Three events inside a single bucket: the bucketed payload has already
		// merged them, the per-event one must not.
		const dots = buildEventDots(
			timeline([{t: 100, count: 3}], undefined, [
				entry(100, 'add.issue', {label: 'Created with title "Ship v2"'}),
				entry(140, 'add.issue.tag', {label: 'Tagged with bug'}),
				entry(180, 'add.issue.comment', {label: 'Commented'}),
			]),
		);

		expect(dots).toHaveLength(3);
		expect(dots.map(dot => dot.t)).toEqual([100, 140, 180]);
		expect(dots.map(dot => dot.label)).toEqual([
			'Created with title "Ship v2"',
			'Tagged with bug',
			'Commented',
		]);
	});

	it('keys events sharing a millisecond apart', () => {
		const dots = buildEventDots(
			timeline([{t: 5, count: 2}], undefined, [
				entry(5, 'add.issue', {label: 'add.issue'}),
				entry(5, 'close.issue', {label: 'close.issue'}),
			]),
		);

		expect(new Set(dots.map(dot => dot.key)).size).toBe(2);
	});

	it('plots one ticket alone when narrowed to it', () => {
		const dots = buildEventDots(
			timeline([{t: 100, count: 3}], undefined, [
				entry(100, 'add.issue', {issue: 'mine', label: 'Created'}),
				entry(140, 'add.issue.tag', {issue: 'theirs', label: 'Tagged'}),
				entry(180, 'add.issue.comment', {issue: 'mine', label: 'Commented'}),
			]),
			'all',
			new Set(),
			'mine',
		);

		expect(dots.map(dot => dot.label)).toEqual(['Created', 'Commented']);
	});

	it('sizes per-event dots uniformly, having no count to encode', () => {
		const dots = buildEventDots(
			timeline([{t: 1, count: 9}], undefined, [
				entry(1, 'add.issue', {label: 'add.issue'}),
				entry(2, 'add.issue', {label: 'add.issue'}),
			]),
		);

		expect(dots.map(dot => dot.size)).toEqual([4, 4]);
		expect(dots.map(dot => dot.opacity)).toEqual([0.55, 0.55]);
		expect(dots.every(dot => dot.count === null)).toBe(true);
	});

	it('falls back to buckets when the server capped the window', () => {
		const dots = buildEventDots(
			timeline([
				{t: 10, count: 1},
				{t: 20, count: 4},
			]),
		);

		expect(dots.map(dot => dot.t)).toEqual([10, 20]);
		expect(dots.map(dot => dot.count)).toEqual([1, 4]);
		// Only the fallback encodes a count, so its dots must still differ.
		expect(dots[0]!.size).toBeLessThan(dots[1]!.size);
		expect(dots.every(dot => dot.label === null)).toBe(true);
	});

	it('has no dots without a timeline', () => {
		expect(buildEventDots(null)).toEqual([]);
	});
});

describe('categoryOf', () => {
	it('sorts each action into its series', () => {
		expect(categoryOf('add.issue.comment')).toBe('comments');
		expect(categoryOf('edit.issue.comment')).toBe('comments');
		expect(categoryOf('add.issue.tag')).toBe('tagging');
		expect(categoryOf('create.tag')).toBe('tagging');
		expect(categoryOf('add.issue.assignee')).toBe('assigning');
		expect(categoryOf('remove.issue.assignee')).toBe('assigning');
		expect(categoryOf('add.issue')).toBe('tickets');
		expect(categoryOf('move.node')).toBe('tickets');
		expect(categoryOf('close.issue')).toBe('tickets');
	});

	it('does not mistake an attachment for a tag', () => {
		// "attachment" and "assignee" both read as near-misses for the substring
		// rules this deliberately avoids.
		expect(categoryOf('add.issue.attachment')).toBe('tickets');
		expect(categoryOf('delete.issue.attachment')).toBe('tickets');
	});

	it('files an unknown action under tickets rather than dropping it', () => {
		expect(categoryOf('some.future.action')).toBe('tickets');
	});
});

describe('category filtering', () => {
	const mixed = () =>
		timeline([{t: 0, count: 4}], {earliest: 0, latest: 10}, [
			entry(1, 'add.issue', {label: 'Created'}),
			entry(2, 'add.issue.comment', {label: 'Commented'}),
			entry(3, 'add.issue.tag', {label: 'Tagged with bug'}),
			entry(4, 'add.issue.assignee', {label: 'Assigned to jola'}),
		]);

	it('draws only the selected kind', () => {
		const dots = buildEventDots(mixed(), 'tickets');

		expect(dots).toHaveLength(1);
		expect(dots[0]!.category).toBe('tickets');
	});

	it('tags every dot with its category', () => {
		const dots = buildEventDots(mixed());

		expect(dots.map(dot => dot.category)).toEqual([
			'tickets',
			'comments',
			'tagging',
			'assigning',
		]);
	});

	it('drops the other kinds from the bars too', () => {
		const axis = buildAxis(mixed(), []);
		const all = bucketIssueCounts(axis, mixed());
		const some = bucketIssueCounts(axis, mixed(), 'comments');

		const total = (counts: number[]) => counts.reduce((a, b) => a + b, 0);

		expect(total(all)).toBe(4);
		expect(total(some)).toBe(1);
	});

	it('counts every kind where the server capped and sent only buckets', () => {
		// No events to read an action off, so the filter has nothing to act on.
		const capped = timeline([{t: 0, count: 7}]);
		const axis = buildAxis(capped, []);

		const counts = bucketIssueCounts(axis, capped, 'tickets');

		expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
		expect(buildEventDots(capped).every(dot => dot.category === null)).toBe(
			true,
		);
	});
});

describe('identity views', () => {
	const jola = person('jola');
	const demo = person('demo');
	const bug = person('bug');

	const window = () =>
		timeline([{t: 0, count: 5}], {earliest: 0, latest: 10}, [
			entry(1, 'add.issue.comment', {actor: jola}),
			entry(2, 'add.issue.comment', {actor: demo}),
			entry(3, 'add.issue.comment', {actor: jola}),
			entry(4, 'add.issue.tag', {actor: jola, tag: bug}),
			entry(5, 'add.issue', {actor: demo}),
		]);

	it('colours by the side of the event the view is about', () => {
		expect(identityAxisFor('comments')).toBe('actor');
		expect(identityAxisFor('tagging')).toBe('tag');
		expect(identityAxisFor('assigning')).toBe('assignee');
		// Every event is somebody changing a ticket, so there is nothing to
		// colour by that the kind does not already say.
		expect(identityAxisFor('tickets')).toBeNull();
		expect(identityAxisFor('all')).toBeNull();
	});

	it('lists each identity once, as the legend for what is on screen', () => {
		expect(listIdentities(window(), 'comments').map(i => i.name)).toEqual([
			'jola',
			'demo',
		]);
		// The tagging view lists tags, not the people who applied them.
		expect(listIdentities(window(), 'tagging').map(i => i.name)).toEqual([
			'bug',
		]);
	});

	it('has no list for a view with no identity axis', () => {
		expect(listIdentities(window(), 'tickets')).toEqual([]);
		expect(listIdentities(window(), 'all')).toEqual([]);
	});

	it('takes each dot colour from its identity, not its kind', () => {
		const dots = buildEventDots(window(), 'comments');

		expect(dots).toHaveLength(3);
		expect(dots.map(dot => dot.color)).toEqual([
			jola.color,
			demo.color,
			jola.color,
		]);
	});

	it('colours by kind in the All view', () => {
		const colors = new Set(buildEventDots(window(), 'all').map(d => d.color));

		// Two kinds present, and neither is anybody's personal colour.
		expect(colors.has(jola.color)).toBe(false);
		expect(colors.size).toBeGreaterThan(1);
	});

	it('hides the unticked identities', () => {
		const dots = buildEventDots(window(), 'comments', new Set([jola.id]));

		expect(dots).toHaveLength(1);
		expect(dots[0]!.identity?.name).toBe('demo');
	});

	it('keeps an event whose view gives it no identity to be hidden by', () => {
		// Nothing in the Tickets list to untick, so an exclusion cannot swallow it.
		expect(
			buildEventDots(window(), 'tickets', new Set([demo.id, jola.id])),
		).toHaveLength(1);
	});

	describe('soleVisibleIdentity', () => {
		const listed = () => listIdentities(window(), 'comments');

		it('names the one identity left when the rest are hidden', () => {
			expect(soleVisibleIdentity(listed(), new Set([jola.id]))?.name).toBe(
				'demo',
			);
		});

		it('is null while more than one is still shown', () => {
			expect(soleVisibleIdentity(listed(), new Set())).toBeNull();
		});

		it('is null when everything is hidden', () => {
			expect(soleVisibleIdentity(listed(), new Set([jola.id, demo.id]))).toBe(
				null,
			);
		});

		it('names the only identity a window holds, filter or not', () => {
			// One tag in the whole window: the series really is that tag, whether
			// anyone unticked their way down to it or it arrived alone.
			expect(
				soleVisibleIdentity(listIdentities(window(), 'tagging'), new Set())
					?.name,
			).toBe('bug');
		});

		it('has nothing to name in a view with no identity axis', () => {
			expect(
				soleVisibleIdentity(listIdentities(window(), 'all'), new Set()),
			).toBeNull();
		});
	});
});

describe('day scope', () => {
	it('sits directly under the hour', () => {
		expect(SCOPES[1]).toBe('day');
		expect(isScope('day')).toBe(true);
	});

	it('spans the 24 hours ending now', () => {
		const range = getPeriodRange('day', 0);

		expect(range).not.toBeNull();
		expect(range!.end - range!.start).toBe(DAY);
	});

	it('steps back a day at a time', () => {
		const now = getPeriodRange('day', 0)!;
		const back = getPeriodRange('day', 2)!;

		expect(Math.round((now.end - back.end) / DAY)).toBe(2);
	});

	it('labels the current window by duration', () => {
		expect(formatPeriodLabel('day', 0, getPeriodRange('day', 0))).toBe(
			'Last 24 hours',
		);
	});
});

describe('hour segments', () => {
	it('snaps to the top of the hour and runs one hour', () => {
		const {start, end, label} = segmentAt(
			new Date(2026, 7, 16, 14, 37).getTime(),
			'hour',
		);

		expect(new Date(start).getMinutes()).toBe(0);
		expect(end - start).toBe(60 * 60 * 1000);
		expect(label).toBe('Sun 14:00');
	});

	it('pads the hour so labels stay the same width', () => {
		expect(segmentAt(new Date(2026, 7, 16, 9, 5).getTime(), 'hour').label).toBe(
			'Sun 09:00',
		);
	});
});

describe('board filter', () => {
	const bug = person('bug');
	const docs = person('docs');
	const jola = person('jola');

	const issue = (
		tags: {id: string}[] = [],
		assignees: {id: string}[] = [],
	) => ({id: 'i1', tags, assignees});

	it('does not filter until the selection is narrowed', () => {
		// A kind with everything still ticked is a colouring choice, not a
		// question about which tickets matter.
		expect(buildBoardFilter('tagging', null)).toBeNull();
	});

	it('does not filter on a view with no identity axis', () => {
		expect(buildBoardFilter('tickets', [bug.id])).toBeNull();
		expect(buildBoardFilter('all', [bug.id])).toBeNull();
	});

	it('keeps the tickets carrying a visible tag', () => {
		const filter = buildBoardFilter('tagging', [bug.id]);

		expect(issuePassesBoardFilter(issue([bug]), [], filter)).toBe(true);
		expect(issuePassesBoardFilter(issue([docs]), [], filter)).toBe(false);
		// Untagged: nothing visible to match, so it is not part of this answer.
		expect(issuePassesBoardFilter(issue(), [], filter)).toBe(false);
	});

	it('reads assignees off the ticket for an assigning view', () => {
		const filter = buildBoardFilter('assigning', [jola.id]);

		expect(issuePassesBoardFilter(issue([], [jola]), [], filter)).toBe(true);
		expect(issuePassesBoardFilter(issue([], [docs]), [], filter)).toBe(false);
		// A tag of the same id must not satisfy an assignee filter.
		expect(issuePassesBoardFilter(issue([jola], []), [], filter)).toBe(false);
	});

	it('reads comment authors for a comments view', () => {
		const filter = buildBoardFilter('comments', [jola.id]);

		expect(issuePassesBoardFilter(issue(), [jola.id], filter)).toBe(true);
		expect(issuePassesBoardFilter(issue(), [docs.id], filter)).toBe(false);
		expect(issuePassesBoardFilter(issue(), [], filter)).toBe(false);
	});

	it('passes everything through when there is no filter', () => {
		expect(issuePassesBoardFilter(issue(), [], null)).toBe(true);
	});
});

describe('windowIssueIds', () => {
	const touching = (t: number, issue: string | null) =>
		entry(t, 'add.issue.tag', {issue});

	it('is the set of tickets the window has an event for', () => {
		const ids = windowIssueIds(
			timeline([], undefined, [
				touching(1, 'issue-1'),
				touching(2, 'issue-2'),
				touching(3, 'issue-1'),
			]),
		);

		expect(ids && [...ids].sort()).toEqual(['issue-1', 'issue-2']);
	});

	it('skips the events that happened to no ticket', () => {
		const ids = windowIssueIds(
			timeline([], undefined, [touching(1, null), touching(2, 'issue-1')]),
		);

		expect(ids && [...ids]).toEqual(['issue-1']);
	});

	it('narrows nothing before a timeline has arrived', () => {
		expect(windowIssueIds(null)).toBeNull();
	});

	it('narrows nothing where the server answered with counts alone', () => {
		// Past its event cap the server sends buckets and no events, so there is
		// no way to tell which tickets they counted.
		expect(windowIssueIds(timeline([{t: 1, count: 40}]))).toBeNull();
	});

	it('narrows to nothing over a window where nothing happened', () => {
		expect(windowIssueIds(timeline([]))?.size).toBe(0);
	});

	it('tells a capped window from a quiet one, so the toggle stays escapable', () => {
		// Both name no tickets, but only the capped one is unfilterable — a
		// quiet window has to stay togglable, or a narrowed board over it
		// cannot be widened again.
		expect(windowNamesIssues(timeline([{t: 1, count: 40}]))).toBe(false);
		expect(windowNamesIssues(timeline([]))).toBe(true);
	});
});

describe('dotEntranceScale', () => {
	it('holds a dot at zero until its own delay has passed', () => {
		expect(dotEntranceScale('abc', 0)).toBe(0);
	});

	it('reaches full size by the end of the stagger and stays there', () => {
		expect(dotEntranceScale('abc', DOT_EXIT_TOTAL_MS)).toBeCloseTo(1, 5);
		expect(dotEntranceScale('abc', DOT_EXIT_TOTAL_MS * 4)).toBeCloseTo(1, 5);
	});

	it('staggers, so two keys are not at the same size mid-entrance', () => {
		const keys = Array.from({length: 40}, (_, i) => `dot-${i}`);
		const midway = new Set(keys.map(k => dotEntranceScale(k, 300).toFixed(3)));

		expect(midway.size).toBeGreaterThan(1);
	});

	it('is the same every time for a given key', () => {
		expect(dotEntranceScale('abc', 200)).toBe(dotEntranceScale('abc', 200));
	});
});

describe('dotExitScale', () => {
	it('starts at full size and ends at nothing', () => {
		expect(dotExitScale('abc', 0)).toBe(1);
		expect(dotExitScale('abc', DOT_EXIT_TOTAL_MS)).toBeCloseTo(0, 5);
	});

	it('retracts in the reverse of the order it arrived', () => {
		// The dot that enters last — the largest entrance delay — leaves first.
		const keys = Array.from({length: 30}, (_, i) => `dot-${i}`);
		const latest = keys.reduce((a, b) =>
			dotEntranceScale(a, 300) < dotEntranceScale(b, 300) ? a : b,
		);
		const earliest = keys.reduce((a, b) =>
			dotEntranceScale(a, 300) > dotEntranceScale(b, 300) ? a : b,
		);

		expect(dotExitScale(latest, 300)).toBeLessThanOrEqual(
			dotExitScale(earliest, 300),
		);
	});
});

describe('chooseSegmentUnit', () => {
	const HOUR = 60 * 60 * 1000;

	it('goes finer than the hour for an hour-wide span', () => {
		// The hour unit would leave the whole track as a single block.
		expect(chooseSegmentUnit(HOUR)).toBe('minute');
	});

	it('keeps the unit every other scope already resolved to', () => {
		expect(chooseSegmentUnit(DAY)).toBe('hour');
		expect(chooseSegmentUnit(7 * DAY)).toBe('day');
		expect(chooseSegmentUnit(30 * DAY)).toBe('day');
		expect(chooseSegmentUnit(365 * DAY)).toBe('month');
	});
});

describe('segmentAt', () => {
	it('snaps a minute segment to its own minute and labels it as a clock time', () => {
		const at = new Date(2026, 7, 22, 14, 23, 45, 500).getTime();
		const segment = segmentAt(at, 'minute');

		expect(new Date(segment.start).getSeconds()).toBe(0);
		expect(segment.end - segment.start).toBe(60 * 1000);
		expect(segment.label).toBe('14:23');
	});
});

describe('hour scope', () => {
	it('is a rolling sixty minutes', () => {
		const range = getPeriodRange('hour', 0);

		expect(range).not.toBeNull();
		expect(range!.end - range!.start).toBe(60 * 60 * 1000);
	});

	it('survives a round trip through the stored value', () => {
		expect(isScope('hour')).toBe(true);
	});

	it('leads the row, which runs finest to coarsest', () => {
		expect([...SCOPES]).toEqual([
			'hour',
			'day',
			'week',
			'month',
			'year',
			'all',
		]);
	});
});
