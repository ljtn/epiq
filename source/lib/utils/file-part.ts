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
		.replace(/^-+|-+$/g, '') || 'unknown';
