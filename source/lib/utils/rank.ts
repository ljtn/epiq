import {failed, isFail, Result, succeeded} from '../model/result-types.js';

// - Fixed-width strings so lexicographic order === numeric order
// - Huge integer space (BigInt)
// - "midpoint" insertion with exhaustion detection

export const HEX_LEN = 24n; // 24 hex chars = 96 bits
const BIT_WIDTH = HEX_LEN * 4n;
export const MAX_RANK = (1n << BIT_WIDTH) - 1n;

const HEX_RE = /^[0-9a-f]+$/;

export function hexToBigInt(rank: string): Result<bigint> {
	if (!rank || !HEX_RE.test(rank)) {
		return failed(`Invalid hex rank: ${rank}`);
	}

	return succeeded('Converted rank to bigint', BigInt('0x' + rank));
}

export function bigIntToHex(n: bigint, len: bigint = HEX_LEN): Result<string> {
	if (n < 0n) return failed('Negative rank not allowed');

	const hex = n.toString(16);
	return succeeded(
		'Converted bigint to hex rank',
		hex.padStart(Number(len), '0'),
	);
}

export function rankBetween(prev?: string, next?: string): Result<string> {
	if (!prev && !next) {
		return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
	}

	const aResult = prev
		? hexToBigInt(prev)
		: succeeded('Resolved lower bound', 0n);
	if (isFail(aResult)) return aResult;

	const bResult = next
		? hexToBigInt(next)
		: succeeded('Resolved upper bound', MAX_RANK);
	if (isFail(bResult)) return bResult;

	const a = aResult.value;
	const b = bResult.value;

	// Neighbours out of order, or holding the same rank — which two clients
	// appending to one lane while unsynced produce routinely, since both read
	// the same last sibling and compute the same midpoint. Returning the middle
	// of the whole space instead put the node somewhere nobody asked for, and
	// could collide again. A failure is what `resolveMoveRank` turns into
	// `needsRebalance`, and rebalancing is the repair this case wants.
	if (b <= a) {
		return failed('Neighbouring ranks leave no space between them');
	}

	const mid = (a + b) / 2n;
	if (mid === a || mid === b) {
		return failed('No rank space available between neighbors');
	}

	return bigIntToHex(mid, HEX_LEN);
}

export function midRank(): Result<string> {
	return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
}

export function evenlySpacedRanks(count: number): Result<string[]> {
	if (count <= 0) return succeeded('Resolved empty rank list', []);

	const n = BigInt(count);
	const out: string[] = [];

	for (let i = 0; i < count; i++) {
		const r = (MAX_RANK * BigInt(i + 1)) / (n + 1n);
		const rankResult = bigIntToHex(r, HEX_LEN);

		if (isFail(rankResult)) return rankResult;
		out.push(rankResult.value);
	}

	return succeeded('Resolved evenly spaced ranks', out);
}
