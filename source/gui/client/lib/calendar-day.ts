// A calendar day as the board writes it, YYYY-MM-DD, read and written in the
// viewer's own time zone: the day they clicked is the day sent, whatever UTC
// makes of that midnight.

const pad = (value: number) => String(value).padStart(2, '0');

export const dayOf = (date: Date): string =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The local midnight a day names, or null for anything not a real day. */
export const dateOfDay = (day: string): Date | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) return null;

	const [year, month, date] = match.slice(1).map(Number) as [
		number,
		number,
		number,
	];
	const parsed = new Date(year, month - 1, date);

	return dayOf(parsed) === day ? parsed : null;
};

export const firstOfMonth = (date: Date): Date =>
	new Date(date.getFullYear(), date.getMonth(), 1);

const addDays = (date: Date, days: number) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

// Same day of the month, or the month's last where it is shorter.
const addMonths = (date: Date, months: number) => {
	const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
	const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);

	return new Date(
		first.getFullYear(),
		first.getMonth(),
		Math.min(date.getDate(), last.getDate()),
	);
};

/** Six weeks from the Monday on or before the 1st: every month fits, at one height. */
export const monthGrid = (month: Date): Date[] => {
	const first = firstOfMonth(month);
	const start = addDays(first, -((first.getDay() + 6) % 7));

	return Array.from({length: 42}, (_, index) => addDays(start, index));
};

/** Where a key moves the focused day in a Monday-first grid, or null for a key that does not. */
export const stepDay = (day: Date, key: string): Date | null => {
	const weekday = (day.getDay() + 6) % 7;
	switch (key) {
		case 'ArrowLeft':
			return addDays(day, -1);
		case 'ArrowRight':
			return addDays(day, 1);
		case 'ArrowUp':
			return addDays(day, -7);
		case 'ArrowDown':
			return addDays(day, 7);
		case 'Home':
			return addDays(day, -weekday);
		case 'End':
			return addDays(day, 6 - weekday);
		case 'PageUp':
			return addMonths(day, -1);
		case 'PageDown':
			return addMonths(day, 1);
		default:
			return null;
	}
};
