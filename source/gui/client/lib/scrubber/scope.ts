import {formatTimeOfDay, isSameDay} from '../../../../lib/utils/date.utils.js';

export type Scope = 'all' | 'hour' | 'day' | 'week' | 'month' | 'year';

export type PeriodRange = {start: number; end: number};

export const SCOPES: readonly Scope[] = [
	'hour',
	'day',
	'week',
	'month',
	'year',
	'all',
];

const SCOPE_DURATION_MS: Record<Exclude<Scope, 'all'>, number> = {
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
	year: 365 * 24 * 60 * 60 * 1000,
};

// Every window is a rolling one ending now, so these read as durations back
// from now rather than as calendar periods.
const SCOPE_RECENT_LABELS: Record<Exclude<Scope, 'all'>, string> = {
	hour: 'Last hour',
	day: 'Last 24 hours',
	week: 'Last 7 days',
	month: 'Last 30 days',
	year: 'Last 365 days',
};

export const isScope = (value: string | null): value is Scope =>
	(SCOPES as readonly string[]).includes(value ?? '');

// Whether the window is a period at all. "All time" with no zoom is the whole
// log, so narrowing anything to it would narrow nothing.
export const isPeriodWindow = (scope: Scope, zoomed: boolean): boolean =>
	scope !== 'all' || zoomed;

export const getPeriodRange = (
	scope: Scope,
	offset: number,
): PeriodRange | null => {
	if (scope === 'all') return null;

	const durationMs = SCOPE_DURATION_MS[scope];
	const end = Date.now() - offset * durationMs;

	return {start: end - durationMs, end};
};

// Narrow enough for the fixed-width label beside the pager, and dated only when
// the window spans more than the one day a date would name.
const compactRangeLabel = (range: PeriodRange): string => {
	const start = new Date(range.start);
	const end = new Date(range.end);

	return isSameDay(start, end)
		? `${formatTimeOfDay(start)} – ${formatTimeOfDay(end)}`
		: `${start.getMonth() + 1}/${start.getDate()} – ${
				end.getMonth() + 1
		  }/${end.getDate()}`;
};

export const formatPeriodLabel = (
	scope: Scope,
	offset: number,
	range: PeriodRange | null,
	// A window dragged out on the chart, which no scope's name describes.
	zoomed = false,
): string => {
	if (!range) return 'All time';
	if (zoomed) return compactRangeLabel(range);
	if (scope === 'all') return 'All time';
	if (offset === 0) return SCOPE_RECENT_LABELS[scope];

	return compactRangeLabel(range);
};

export const scopeButtonLabel = (scope: Scope): string =>
	scope === 'all' ? 'All' : scope[0]!.toUpperCase() + scope.slice(1);

// ---------------------------------------------------------------- animations
