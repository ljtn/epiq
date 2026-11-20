// ULIDs: 10 chars of millisecond time, 16 of randomness, in Crockford base32.
// Same contract as the ulid package, throws included: callers catch an undecodable id.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const TIME_MAX = 2 ** 48 - 1;

export const encodeTime = (now: number, length = TIME_LEN): string => {
	if (!Number.isInteger(now) || now < 0 || now > TIME_MAX) {
		throw new Error(`Cannot encode time: ${now}`);
	}

	let rest = now;
	let out = '';
	for (let index = 0; index < length; index++) {
		const digit = rest % 32;
		out = ENCODING[digit] + out;
		rest = (rest - digit) / 32;
	}

	return out;
};

// 256 is a multiple of 32, so masking a byte keeps every character equally likely.
const encodeRandom = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
	let out = '';
	for (const byte of bytes) out += ENCODING[byte & 31];
	return out;
};

const incrementBase32 = (value: string): string => {
	const chars = [...value];
	for (let index = chars.length - 1; index >= 0; index--) {
		const digit = ENCODING.indexOf(chars[index]!);
		if (digit === -1) throw new Error(`Not base32: ${value}`);
		if (digit < 31) {
			chars[index] = ENCODING[digit + 1]!;
			return chars.join('');
		}

		chars[index] = ENCODING[0]!;
	}

	throw new Error(`Cannot increment past ${value}`);
};

const seedOrNow = (seedTime?: number): number =>
	!seedTime || Number.isNaN(seedTime) ? Date.now() : seedTime;

export const ulid = (seedTime?: number): string =>
	encodeTime(seedOrNow(seedTime)) + encodeRandom();

/** Ids that sort after every earlier one it minted, even when the seed time stalls or goes back. */
export const monotonicFactory = () => {
	let lastTime = 0;
	let lastRandom = '';

	return (seedTime?: number): string => {
		const seed = seedOrNow(seedTime);
		if (seed <= lastTime) {
			lastRandom = incrementBase32(lastRandom);
			return encodeTime(lastTime) + lastRandom;
		}

		lastTime = seed;
		lastRandom = encodeRandom();
		return encodeTime(seed) + lastRandom;
	};
};

export const decodeTime = (id: string): number => {
	if (id.length !== TIME_LEN + RANDOM_LEN) {
		throw new Error(`Malformed ULID: ${id}`);
	}

	let time = 0;
	for (const char of id.slice(0, TIME_LEN).toUpperCase()) {
		const digit = ENCODING.indexOf(char);
		if (digit === -1) throw new Error(`Malformed ULID: ${id}`);
		time = time * 32 + digit;
	}

	if (time > TIME_MAX) throw new Error(`Malformed ULID: ${id}`);
	return time;
};
