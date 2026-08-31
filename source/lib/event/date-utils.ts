import {decodeTime} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';
import {AppEvent} from './event.model.js';

// Honest clock skew between machines is minutes; a decoded time further ahead
// than this is not a fact about time. Also bounds the mint seed in event-persist.
export const MAX_ULID_AHEAD_MS = 24 * 60 * 60 * 1000;

export const clampUlidTime = (t: number, now = Date.now()): number =>
	t > now + MAX_ULID_AHEAD_MS ? now : t;

// Display-boundary decode: a poisoned far-future id reads as now. Throws like
// decodeTime on an undecodable id.
export const ulidTimeMs = (id: string): number => clampUlidTime(decodeTime(id));

// Effective times for one causally ordered event set: a poisoned time inherits
// its predecessor's (else the first honest) time, deterministically per set. A
// set with no honest time passes through raw; nulls (undecodable ids) pass through.
export const toEffectiveUlidTimes = (
	times: ReadonlyArray<number | null>,
): Array<number | null> => {
	const ceiling = Date.now() + MAX_ULID_AHEAD_MS;
	const firstHonest = times.find(t => t !== null && t <= ceiling) ?? null;
	if (firstHonest === null) return [...times];

	let previous: number | null = null;

	return times.map(t => {
		if (t === null) return null;

		const effective = t <= ceiling ? t : previous ?? firstHonest;
		previous = effective;

		return effective;
	});
};

export const safeDateFromUlid = (id: string): Result<Date> => {
	try {
		return succeeded('Decoded date', new Date(ulidTimeMs(id)));
	} catch (error) {
		return failed('Decoding failed + ' + (error as Error).message);
	}
};

// Raw decode — route displays through ulidTimeMs and cross-event comparisons
// through toEffectiveUlidTimes.
export const getEventTime = (event: AppEvent | undefined): number | null => {
	if (!event?.id) return null;

	try {
		return decodeTime(event.id);
	} catch {
		return null;
	}
};
