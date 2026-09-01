import {describe, expect, it} from 'vitest';
import {isFail} from '../lib/model/result-types.js';
import {MAX_RANK, bigIntToHex, rankBetween} from '../lib/utils/rank.js';

const hex = (value: bigint): string => {
	const result = bigIntToHex(value);
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const MID = hex(MAX_RANK / 2n);

describe('rankBetween', () => {
	it('lands between two neighbours', () => {
		const result = rankBetween(hex(10n), hex(100n));

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value > hex(10n)).toBe(true);
		expect(result.value < hex(100n)).toBe(true);
	});

	it('uses the middle of the space when there are no neighbours', () => {
		const result = rankBetween(undefined, undefined);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe(MID);
	});

	/**
	 * Two clients appending to one lane while unsynced both read the same last
	 * sibling and compute the same midpoint, so equal sibling ranks are ordinary
	 * traffic rather than corruption.
	 *
	 * This used to return the middle of the whole space — a success — so
	 * "move this after that one" silently put the node somewhere nobody asked
	 * for, and `resolveMoveRank` never learned it needed a rebalance.
	 */
	it('refuses to place a node between two equal ranks', () => {
		expect(isFail(rankBetween(hex(500n), hex(500n)))).toBe(true);
	});

	it('refuses neighbours that are the wrong way round', () => {
		expect(isFail(rankBetween(hex(900n), hex(100n)))).toBe(true);
	});

	it('refuses to append after a sibling already at the ceiling', () => {
		expect(isFail(rankBetween(hex(MAX_RANK), undefined))).toBe(true);
	});

	it('refuses to insert before a sibling already at the floor', () => {
		expect(isFail(rankBetween(undefined, hex(0n)))).toBe(true);
	});

	it('still refuses adjacent neighbours with no room between them', () => {
		expect(isFail(rankBetween(hex(1n), hex(2n)))).toBe(true);
	});
});
