// Import-free on purpose: the browser client reaches in here, and anything
// under lib/event pulls Node-only code into its type program.

export const timeAgo = (timestampMs: number): string => {
	const diff = Date.now() - timestampMs;

	const units = [
		{label: 'y', ms: 1000 * 60 * 60 * 24 * 365},
		{label: 'mo', ms: 1000 * 60 * 60 * 24 * 30},
		{label: 'w', ms: 1000 * 60 * 60 * 24 * 7},
		{label: 'd', ms: 1000 * 60 * 60 * 24},
		{label: 'h', ms: 1000 * 60 * 60},
		{label: 'm', ms: 1000 * 60},
		{label: 's', ms: 1000},
	];

	for (const {label, ms} of units) {
		const value = Math.floor(diff / ms);
		if (value >= 1) return `${value}${label} ago`;
	}

	return 'just now';
};

const pad = (n: number) => String(n).padStart(2, '0');

export const formatDateTime = (date: Date): string =>
	`${date.getFullYear()}-` +
	`${pad(date.getMonth() + 1)}-` +
	`${pad(date.getDate())} ` +
	`${pad(date.getHours())}:` +
	`${pad(date.getMinutes())}`;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The day of the week, which tells a reader what a date on its own does not:
// whether a stretch of work was a Tuesday or a Sunday.
export const formatWeekday = (date: Date): string =>
	WEEKDAY_LABELS[date.getDay()]!;

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

export const formatMonth = (date: Date): string =>
	MONTH_LABELS[date.getMonth()]!;

// "Tue, Oct 7" — a day written to be read rather than parsed, for the divider
// a list puts between one day's entries and the next. No year: a divider says
// which day the lines under it belong to, and the lines themselves are already
// in order.
export const formatDayLabel = (date: Date): string =>
	`${formatWeekday(date)}, ${formatMonth(date)} ${date.getDate()}`;

// Only the clock, for the second half of an interval that stays inside one day.
export const formatTimeOfDay = (date: Date): string =>
	`${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const isSameDay = (a: Date, b: Date): boolean =>
	a.getFullYear() === b.getFullYear() &&
	a.getMonth() === b.getMonth() &&
	a.getDate() === b.getDate();
