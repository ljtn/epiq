import {describe, expect, it} from 'vitest';
import {
	decodeTime,
	encodeTime,
	monotonicFactory,
	ulid,
} from '../lib/event/ulid.js';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid', () => {
	// Vectors from the ulid package this module replaced.
	it.each([
		[0, '0000000000'],
		[1_469_918_176_385, '01ARYZ6S41'],
		[2 ** 48 - 1, '7ZZZZZZZZZ'],
	])('encodes %d as %s', (time, encoded) => {
		expect(encodeTime(time)).toBe(encoded);
		expect(decodeTime(encoded + '0'.repeat(16))).toBe(time);
	});

	it.each([2 ** 48, -1, 1.5, Number.NaN])('refuses to encode %d', time => {
		expect(() => encodeTime(time)).toThrow();
	});

	it('decodes lower case', () => {
		expect(decodeTime('01aryz6s41tsv4rrffq69g5fav')).toBe(1_469_918_176_385);
	});

	it.each([
		'',
		'01ARYZ6S41TSV4RRFFQ69G5FA',
		'01ARYZ6S41TSV4RRFFQ69G5FAVX',
		'0IARYZ6S41TSV4RRFFQ69G5FAV',
		'8ZZZZZZZZZTSV4RRFFQ69G5FAV',
	])('refuses to decode %j', id => {
		expect(() => decodeTime(id)).toThrow();
	});

	it('mints well-formed ids at the seed time', () => {
		const id = ulid(1_700_000_000_000);

		expect(id).toMatch(ULID);
		expect(decodeTime(id)).toBe(1_700_000_000_000);
	});

	it('keeps sorting after its last id when the clock stalls or goes back', () => {
		const next = monotonicFactory();
		const ids = [1000, 1000, 999, 1001, 1001].map(seed => next(seed));

		expect([...ids].sort()).toEqual(ids);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.map(decodeTime)).toEqual([1000, 1000, 1000, 1001, 1001]);
	});
});
