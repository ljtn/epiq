import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {
	clampUlidTime,
	clampUlidTimes,
	safeDateFromUlid,
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

describe('clampUlidTimes', () => {
	it('maps a poisoned time to the latest honest time in the set', () => {
		const now = Date.now();
		const honest = [now - 10_000, now - 5_000];

		expect(clampUlidTimes([...honest, now + CENTURY_MS])).toEqual([
			...honest,
			now - 5_000,
		]);
	});

	it('leaves nulls and honest times untouched', () => {
		const now = Date.now();
		const times = [null, now - 1_000, null];

		expect(clampUlidTimes(times)).toEqual(times);
	});

	it('falls back to now when every time is poisoned', () => {
		const before = Date.now();
		const [clamped] = clampUlidTimes([before + CENTURY_MS]);
		const after = Date.now();

		expect(clamped).toBeGreaterThanOrEqual(before);
		expect(clamped).toBeLessThanOrEqual(after);
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
