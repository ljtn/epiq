// - Fixed-width strings so lexicographic order === numeric order
// - Huge integer space (BigInt)
// - "midpoint" insertion with exhaustion detection (returns '' when no room)

export const HEX_LEN = 24n; // 24 hex chars = 96 bits (fixed width)
const BIT_WIDTH = HEX_LEN * 4n; // 4 bits per hex char
export const MAX_RANK = (1n << BIT_WIDTH) - 1n;

const HEX_RE = /^[0-9a-f]+$/;

export function hexToBigInt(rank: string): bigint {
	if (!rank || !HEX_RE.test(rank)) {
		throw new Error(`Invalid hex rank: ${rank}`);
	}
	return BigInt('0x' + rank);
}

export function bigIntToHex(n: bigint, len: bigint = HEX_LEN): string {
	if (n < 0n) throw new Error('Negative rank not allowed');
	const hex = n.toString(16); // lowercase
	return hex.padStart(Number(len), '0');
}

/**
 * Returns a fixed-width hex rank strictly between prev and next.
 * If there is no room (gap <= 1), returns '' (signals exhaustion).
 */
export function rankBetween(prev?: string, next?: string): string {
	if (!prev && !next) {
		// Center of entire rank space
		return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
	}

	const a = prev ? hexToBigInt(prev) : 0n;
	const b = next ? hexToBigInt(next) : MAX_RANK;

	if (b <= a) {
		// Corrupt / unexpected ordering; recover to center
		return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
	}

	const mid = (a + b) / 2n;
	if (mid === a || mid === b) return ''; // no room

	return bigIntToHex(mid, HEX_LEN);
}

/**
 * Convenience fallback rank (center). Useful when recovering from weird states.
 */
export function midRank(): string {
	return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
}

/**
 * Returns evenly spaced ranks for N items across the full range.
 * Useful for rebalancing.
 */
export function evenlySpacedRanks(count: number): string[] {
	if (count <= 0) return [];
	const n = BigInt(count);
	const out: string[] = [];

	for (let i = 0; i < count; i++) {
		const r = (MAX_RANK * BigInt(i + 1)) / (n + 1n);
		out.push(bigIntToHex(r, HEX_LEN));
	}

	return out;
}
