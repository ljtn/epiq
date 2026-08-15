/**
 * Encodes one segment of an event log file name (`<userId>.<userName>.jsonl`).
 *
 * Lowercases so the name survives filesystems that differ in case sensitivity,
 * and collapses anything outside the safe set to '-'. Lossy on purpose: this
 * is a storage encoding, not a value.
 *
 * Lives here, apart from the persist layer, because reading a log file name
 * back is the only way to recover an actor — so the decode side needs the same
 * rule to tell "this is the registry's name, encoded" apart from "this is a
 * different name". See `preferBestName` in contributor.utils.ts.
 *
 * Pure and dependency-free, so both sides can import it without dragging in
 * the persist layer's filesystem and state imports.
 */
export const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';
