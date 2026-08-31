import {decodeTime} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';
import {AppEvent} from './event.model.js';

// Mirrors MAX_EDGE_AHEAD_MS in event-persist: honest clock skew is minutes.
// The mint guard keeps new ids near the wall clock, but the log is append-only,
// so a far-future id already in it is permanent — its decoded time is not a
// fact. Clamp before displaying, pacing or windowing by it.
const MAX_ULID_AHEAD_MS = 24 * 60 * 60 * 1000;

export const clampUlidTime = (t: number, now = Date.now()): number =>
	t > now + MAX_ULID_AHEAD_MS ? now : t;

// For consumers that compare times within one event set (time-travel cuts,
// replay pacing, timeline windows): a poisoned time becomes the latest honest
// time in the set, so its placement is the same on every machine no matter
// when the set is read. Nulls (undecodable ids) pass through.
export const clampUlidTimes = (
	times: ReadonlyArray<number | null>,
): Array<number | null> => {
	const ceiling = Date.now() + MAX_ULID_AHEAD_MS;
	let latestHonest: number | null = null;

	for (const t of times) {
		if (
			t !== null &&
			t <= ceiling &&
			(latestHonest === null || t > latestHonest)
		) {
			latestHonest = t;
		}
	}

	return times.map(t =>
		t === null || t <= ceiling ? t : latestHonest ?? Date.now(),
	);
};

export const safeDateFromUlid = (id: string): Result<Date> => {
	try {
		return succeeded('Decoded date', new Date(clampUlidTime(decodeTime(id))));
	} catch (error) {
		return failed('Decoding failed + ' + (error as Error).message);
	}
};

// Raw decode — route display or cross-event comparisons through clampUlidTime(s).
export const getEventTime = (event: AppEvent | undefined): number | null => {
	if (!event?.id) return null;

	try {
		return decodeTime(event.id);
	} catch {
		return null;
	}
};
