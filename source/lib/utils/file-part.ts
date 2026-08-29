/**
 * Encodes one segment of an event log file name (`<userId>.<userName>.jsonl`).
 * Lossy on purpose: this is a storage encoding, never a display value. The
 * actor id round-trips (ULIDs survive the charset); the name segment does not,
 * so display names come from the contributor registry.
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
