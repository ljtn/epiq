import {
	formatDateTime,
	formatMonth,
	formatTimeOfDay,
	formatWeekday,
	isSameDay,
} from '../../../../lib/utils/date.utils.js';

// Finest first — chooseSegmentUnit relies on the order.
const SEGMENT_UNIT_ORDER = [
	'minute',
	'hour',
	'day',
	'week',
	'month',
	'year',
] as const;
export type SegmentUnit = (typeof SEGMENT_UNIT_ORDER)[number];

const APPROX_UNIT_MS: Record<SegmentUnit, number> = {
	minute: 60 * 1000,
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30.44 * 24 * 60 * 60 * 1000,
	year: 365.25 * 24 * 60 * 60 * 1000,
};

// Kept above 30 so a month's view lands comfortably on days instead of flipping
// unit between runs with slightly different spans.
const MAX_SEGMENTS = 35;

// A unit this coarse for the span leaves the track as one block, which tells
// the reader nothing. Only the hour scope reaches it; every other span yields
// seven segments or more.
const MIN_SEGMENTS = 2;

export const chooseSegmentUnit = (spanMs: number): SegmentUnit => {
	const index = SEGMENT_UNIT_ORDER.findIndex(
		unit => spanMs / APPROX_UNIT_MS[unit] <= MAX_SEGMENTS,
	);
	if (index === -1) return 'year';

	const chosen = SEGMENT_UNIT_ORDER[index]!;
	if (spanMs / APPROX_UNIT_MS[chosen] >= MIN_SEGMENTS) return chosen;

	return SEGMENT_UNIT_ORDER[Math.max(0, index - 1)]!;
};

const advanceByUnit = (date: Date, unit: SegmentUnit): void => {
	if (unit === 'minute') date.setMinutes(date.getMinutes() + 1);
	else if (unit === 'hour') date.setHours(date.getHours() + 1);
	else if (unit === 'day') date.setDate(date.getDate() + 1);
	else if (unit === 'week') date.setDate(date.getDate() + 7);
	else if (unit === 'month') date.setMonth(date.getMonth() + 1);
	else date.setFullYear(date.getFullYear() + 1);
};

export type Segment = {start: number; end: number; label: string};

// Stepping via the Date setters rather than millisecond arithmetic is what
// keeps midnight at midnight across DST, where a day is 23 or 25 hours long.
export const segmentAt = (time: number, unit: SegmentUnit): Segment => {
	const start = new Date(time);

	// Each unit clears everything below it; day and coarser snap to midnight.
	if (unit === 'minute') start.setSeconds(0, 0);
	else if (unit === 'hour') start.setMinutes(0, 0, 0);
	else start.setHours(0, 0, 0, 0);

	if (unit === 'week') {
		// Snap back to Monday (getDay is Sunday-based, so rotate it).
		start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
	} else if (unit === 'month') {
		start.setDate(1);
	} else if (unit === 'year') {
		start.setMonth(0, 1);
	}

	const end = new Date(start);
	advanceByUnit(end, unit);

	// The last moment inside the period, not the first after it — labelling a
	// week as "10 – 17 Aug" would wrongly imply 8 days.
	const lastDay = new Date(end.getTime() - 1);

	const clock = (date: Date): string =>
		`${String(date.getHours()).padStart(2, '0')}:${String(
			date.getMinutes(),
		).padStart(2, '0')}`;

	const label =
		unit === 'minute'
			? clock(start)
			: unit === 'hour'
			? `${formatWeekday(start)} ${String(start.getHours()).padStart(
					2,
					'0',
			  )}:00`
			: unit === 'day'
			? `${formatWeekday(start)} ${start.getDate()} ${formatMonth(start)}`
			: unit === 'week'
			? start.getMonth() === lastDay.getMonth()
				? `${start.getDate()}–${lastDay.getDate()} ${formatMonth(start)}`
				: `${start.getDate()} ${formatMonth(
						start,
				  )} – ${lastDay.getDate()} ${formatMonth(lastDay)}`
			: unit === 'month'
			? `${formatMonth(start)} ${start.getFullYear()}`
			: `${start.getFullYear()}`;

	return {start: start.getTime(), end: end.getTime(), label};
};

export const formatInterval = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);

	const endLabel = isSameDay(startDate, endDate)
		? formatTimeOfDay(endDate)
		: formatDateTime(endDate);

	return `${formatDateTime(startDate)} – ${endLabel}`;
};

// --------------------------------------------------------------------- scope
