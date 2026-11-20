import {describe, expect, it} from 'vitest';
import {decodeTime as decodeTimeSlowly, ulid} from '../lib/event/ulid.js';
import {
	clampUlidTime,
	decodeTime,
	safeDateFromUlid,
	toEffectiveUlidTimes,
	ulidTimeMs,
} from '../lib/event/date-utils.js';
import {isSuccess} from '../lib/model/result-types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CENTURY_MS = 100 * 365 * DAY_MS;

describe('clampUlidTime', () => {
	it('passes an honest time through untouched', () => {
		const t = Date.now() - 5_000;
		expect(clampUlidTime(t)).toBe(t);
	});

	it('tolerates a time within a day of skew ahead', () => {
		const now = Date.now();
		const t = now + 60_000;
		expect(clampUlidTime(t, now)).toBe(t);
	});

	it('clamps a far-future time to now', () => {
		const now = Date.now();
		expect(clampUlidTime(now + CENTURY_MS, now)).toBe(now);
	});
});

describe('ulidTimeMs', () => {
	it('decodes an honest id exactly', () => {
		const t = Date.now() - 5_000;
		expect(ulidTimeMs(ulid(t))).toBe(t);
	});

	it('clamps a poisoned id to the present', () => {
		const before = Date.now();
		const t = ulidTimeMs(ulid(before + CENTURY_MS));
		const after = Date.now();

		expect(t).toBeGreaterThanOrEqual(before);
		expect(t).toBeLessThanOrEqual(after);
	});
});

describe('toEffectiveUlidTimes', () => {
	it('gives a poisoned time its predecessor’s effective time, not the set maximum', () => {
		const now = Date.now();
		const times = [now - 10_000, now + CENTURY_MS, now - 5_000];

		expect(toEffectiveUlidTimes(times)).toEqual([
			now - 10_000,
			now - 10_000,
			now - 5_000,
		]);
	});

	it('chains inherited times through consecutive poisoned entries', () => {
		const now = Date.now();
		const times = [now - 10_000, now + CENTURY_MS, now + CENTURY_MS * 2];

		expect(toEffectiveUlidTimes(times)).toEqual([
			now - 10_000,
			now - 10_000,
			now - 10_000,
		]);
	});

	it('falls back to the first honest time for a poisoned leading entry', () => {
		const now = Date.now();
		const times = [now + CENTURY_MS, now - 5_000];

		expect(toEffectiveUlidTimes(times)).toEqual([now - 5_000, now - 5_000]);
	});

	it('passes an all-poisoned set through raw, keeping it self-consistent', () => {
		const now = Date.now();
		const times = [now + CENTURY_MS, now + CENTURY_MS + 1_000];

		expect(toEffectiveUlidTimes(times)).toEqual(times);
	});

	it('passes nulls through without advancing the inheritance', () => {
		const now = Date.now();
		const times = [now - 10_000, null, now + CENTURY_MS];

		expect(toEffectiveUlidTimes(times)).toEqual([
			now - 10_000,
			null,
			now - 10_000,
		]);
	});
});

describe('safeDateFromUlid', () => {
	it('clamps a poisoned id to the present instead of a far-future date', () => {
		const before = Date.now();
		const result = safeDateFromUlid(ulid(before + CENTURY_MS));
		const after = Date.now();

		expect(isSuccess(result)).toBe(true);
		if (!isSuccess(result)) return;

		expect(result.value.getTime()).toBeGreaterThanOrEqual(before);
		expect(result.value.getTime()).toBeLessThanOrEqual(after);
	});
});

describe('decodeTime', () => {
	it('decodes as the ulid package does, and fails where it fails', () => {
		const ids = [
			'01ARZ3NDEKTSV4RRFFQ69G5FAV',
			'01arz3ndektsv4rrffq69g5fav',
			'7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
			'80000000000000000000000000',
			'0000000000000000000000000I',
			'01ARZ3NDEI TSV4RRFFQ69G5FA',
			'0ßARZ3NDEKTSV4RRFFQ69G5FA',
			'01ARZ3NDEKTSV4RRFFQ69G5FAVX',
			'',
		];
		const outcome = (decode: (id: string) => number, id: string) => {
			try {
				return decode(id);
			} catch (error) {
				return (error as Error).message;
			}
		};
		for (const id of ids) {
			expect(outcome(decodeTime, id)).toEqual(outcome(decodeTimeSlowly, id));
		}
	});
});
