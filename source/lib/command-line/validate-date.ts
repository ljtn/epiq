const PEEK_OFFSET_FORMAT = /^(\d+)(h|d|w|mo|y)$/;
const PEEK_DATE_FORMAT =
	/^(\d{4})-(\d{2})-(\d{2})(?:(?::|\s)(\d{2}):(\d{2}))?$/;

const isValidDateTime = ({
	year,
	month,
	day,
	hour = 0,
	minute = 0,
}: {
	year: number;
	month: number;
	day: number;
	hour?: number;
	minute?: number;
}): boolean => {
	const date = new Date(year, month - 1, day, hour, minute);

	return (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day &&
		date.getHours() === hour &&
		date.getMinutes() === minute
	);
};

const parseOffset = (raw: string, now = new Date()): Date | null => {
	const match = raw.match(PEEK_OFFSET_FORMAT);
	if (!match) return null;

	const [, amountRaw, unit] = match;
	const amount = Number(amountRaw);

	if (!Number.isInteger(amount) || amount <= 0) return null;

	const date = new Date(now);

	switch (unit) {
		case 'h':
			date.setHours(date.getHours() - amount);
			return date;
		case 'd':
			date.setDate(date.getDate() - amount);
			return date;
		case 'w':
			date.setDate(date.getDate() - amount * 7);
			return date;
		case 'mo':
			date.setMonth(date.getMonth() - amount);
			return date;
		case 'y':
			date.setFullYear(date.getFullYear() - amount);
			return date;
		default:
			return null;
	}
};

const parseDate = (raw: string): Date | null => {
	const match = raw.match(PEEK_DATE_FORMAT);
	if (!match) return null;

	const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] = match;

	const year = Number(yearRaw);
	const month = Number(monthRaw);
	const day = Number(dayRaw);
	const hour = hourRaw ? Number(hourRaw) : 0;
	const minute = minuteRaw ? Number(minuteRaw) : 0;

	if (
		!isValidDateTime({
			year,
			month,
			day,
			hour,
			minute,
		})
	) {
		return null;
	}

	return new Date(year, month - 1, day, hour, minute);
};

export const parsePeekDateInput = (input: string): Date | null => {
	const raw = input.trim().toLowerCase();

	return parseOffset(raw) ?? parseDate(raw);
};

export const isDateWithinPeekHorizon = ({
	date,
	horizonDate,
}: {
	date: Date;
	horizonDate: Date | null;
}): boolean => {
	if (!horizonDate) return true;

	return date.getTime() >= horizonDate.getTime();
};

// =========================================
// Hints
// =========================================

type Unit = 'h' | 'd' | 'w' | 'mo' | 'y';

type RangeConfig = {
	unit: Unit;
	from: number;
	to: number;
};

const DEFAULT_RANGES: RangeConfig[] = [
	{unit: 'h', from: 1, to: 24},
	{unit: 'd', from: 1, to: 7},
	{unit: 'w', from: 1, to: 52},
	{unit: 'mo', from: 1, to: 12},
	{unit: 'y', from: 1, to: 5},
];

export const generatePeekOffsetHints = (
	ranges: RangeConfig[] = DEFAULT_RANGES,
): string[] => {
	const hints: string[] = [];

	for (const {unit, from, to} of ranges) {
		for (let i = from; i <= to; i++) {
			hints.push(`${i}${unit}`);
		}
	}

	return hints;
};

export const getAvailablePeekHints = (
	horizonDate: Date | null,
	limit = 20,
): string[] => {
	const allHints = generatePeekOffsetHints();

	const validHints = allHints.filter(hint => {
		const date = parseOffset(hint);
		if (!date) return false;

		return isDateWithinPeekHorizon({
			date,
			horizonDate,
		});
	});

	return validHints.slice(0, limit);
};
