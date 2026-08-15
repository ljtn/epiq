/**
 * Encodes one segment of an event log file name (`<userId>.<userName>.jsonl`).
 * Lossy on purpose: this is a storage encoding, never a display value. Decoding
 * a log file name is the only way to recover an actor, so `preferBestName` has
 * to re-apply this rule to tell an encoded name from a different one.
 */
export const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';
