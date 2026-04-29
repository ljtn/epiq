import {decodeTime} from 'ulid';
import {failed, Result, succeeded} from '../lib/command-line/command-types.js';
import {AppEvent} from './event.model.js';

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

export const formatDateTime = (date: Date): string => {
	const pad = (n: number) => String(n).padStart(2, '0');

	return (
		`${date.getFullYear()}-` +
		`${pad(date.getMonth() + 1)}-` +
		`${pad(date.getDate())} ` +
		`${pad(date.getHours())}:` +
		`${pad(date.getMinutes())}`
	);
};

export const safeDateFromUlid = (id: string): Result<Date> => {
	try {
		return succeeded('Decoded date', new Date(decodeTime(id)));
	} catch (err) {
		return failed('Decoding failed + ' + (err as Error).message);
	}
};

export const getEventTime = (event: AppEvent | undefined): number | null => {
	if (!event?.id) return null;

	try {
		return decodeTime(event.id);
	} catch {
		return null;
	}
};
