/**
 * Encodes the actor id an event log file name is made of (`<userId>.jsonl`).
 * Lossy on purpose: this is a storage encoding, never a display value. A ULID
 * round-trips it; display names never reach it, because since ZFZFW9D no part
 * of the name carries one — they come from the contributor registry.
 *
 * Still tolerant of a name-shaped input, because a log written before ZFZFW9D
 * carries `<userId>.<userName>.jsonl` and is read unchanged.
 */
export const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		// A second `.jsonl` in the composed name fails `getEventLogPath`'s guard,
		// which left anyone whose display name contained one unable to write at
		// all. `.` survives sanitizing on purpose ("J. Lampa"), so the collision
		// has to be broken here rather than by rejecting the path afterwards.
		.replace(/\.jsonl/g, '-jsonl')
		.replace(/^-+|-+$/g, '') || 'unknown';
