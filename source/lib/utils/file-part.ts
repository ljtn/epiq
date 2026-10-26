/**
 * Encodes the actor id of a log file name (`<userId>.jsonl`); lossy storage,
 * never display. Old `<userId>.<userName>.jsonl` names still parse.
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
