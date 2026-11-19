import {decodeTime as decodeTimeSlowly} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DIGITS = new Int8Array(128).fill(-1);
for (const [value, char] of [...CROCKFORD].entries()) {
	DIGITS[char.charCodeAt(0)] = value;
	DIGITS[char.toLowerCase().charCodeAt(0)] = value;
}
const ULID_LENGTH = 26;
const TIME_LENGTH = 10;
const TIME_MAX = 2 ** 48 - 1;

// The ulid package's decodeTime, without its per-character arrays. Anything
// but ASCII goes to it: its upper-casing can change the length.
export const decodeTime = (id: string): number => {
	if (id.length !== ULID_LENGTH) return decodeTimeSlowly(id);

	let time = 0;
	for (let index = 0; index < TIME_LENGTH; index++) {
		const code = id.charCodeAt(index);
		const digit = code < 128 ? DIGITS[code]! : -1;
		if (digit < 0) return decodeTimeSlowly(id);
		time = time * 32 + digit;
	}

	return time > TIME_MAX ? decodeTimeSlowly(id) : time;
};

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
export const getEventTime = (
	event: {id: string} | undefined,
): number | null => {
	if (!event?.id) return null;

	try {
		return decodeTime(event.id);
	} catch {
		return null;
	}
};
