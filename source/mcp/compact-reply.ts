// Inside a reply, what an agent never reads is left out: colours, false flags,
// nulls and empty lists. Floats keep two significant decimals.

const DROPPED_KEYS = new Set(['color']);

const isEmpty = (value: unknown): boolean =>
	value === false ||
	value === null ||
	value === undefined ||
	(Array.isArray(value) && value.length === 0);

const round = (value: number): number =>
	Number.isInteger(value)
		? value
		: Math.abs(value) >= 1
		? Math.round(value * 100) / 100
		: Number(value.toPrecision(2));

/** The value itself is kept as it is, even empty; only its fields are left out. */
export const compactReply = (value: unknown): unknown => {
	if (typeof value === 'number') return round(value);
	if (Array.isArray(value)) return value.map(compactReply);
	if (!value || typeof value !== 'object') return value;

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (DROPPED_KEYS.has(key) || isEmpty(item)) continue;
		out[key] = compactReply(item);
	}

	return out;
};
