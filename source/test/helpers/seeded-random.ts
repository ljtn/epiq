// Mulberry32: 32-bit integer arithmetic throughout, so the same seed gives the
// same sequence and a randomized test fails the same way twice.
export const seededRandom = (seed: number): ((n: number) => number) => {
	let state = seed >>> 0;

	return n => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
	};
};
