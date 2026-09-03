// Whether the log has moved.
//
// Deriving anything from the log — the board, the timeline — costs a pass over
// all of it, and between two reads it has usually not changed at all. This is
// what lets a reader answer "is what I built still true?" without reading the
// log to find out.
//
// Every actor writes its own file, so it covers the directory rather than one
// file: a teammate's events arriving is their file growing, or appearing for the
// first time, and either moves the signature. Append-only means a size that has
// not moved is content that has not moved; mtime catches a file a sync replaced
// wholesale rather than appended to.
//
// Read it BEFORE the log, never after. Any file can gain lines from another
// machine between two reads, sync included: taken first, a write landing in the
// gap is cached under the older signature and rebuilt on the next request.
// Taken afterwards, that write would be stored under the signature of a log it
// does not match, and nothing would ever rebuild it.

import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {getEventsDirPath} from '../storage/paths.js';

export const logSignature = (stateBranchRoot: string): string => {
	const dir = getEventsDirPath(stateBranchRoot);
	if (!existsSync(dir)) return 'none';

	return readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.sort()
		.map(file => {
			const {size, mtimeMs} = statSync(path.join(dir, file));

			return `${file}:${size}:${mtimeMs}`;
		})
		.join('|');
};

// The signature that follows an append this process made itself, or null when
// anything else moved.
//
// A write is the one change a process does not have to discover: it wrote the
// line, and — since materializing comes before persisting — it had already
// applied the event when the file grew. So the new signature can be adopted
// rather than paid for with a re-read of the whole log.
//
// Only when this actor's file is the one that moved. Another log growing,
// appearing or vanishing means someone else's events arrived, which this
// process has *not* applied, and adopting a signature that covers them would
// leave it certain of a board it never derived.
const entries = (signature: string): Map<string, string> =>
	new Map(
		signature
			.split('|')
			.filter(Boolean)
			.map(part => {
				const at = part.indexOf(':');
				return [part.slice(0, at), part.slice(at + 1)] as const;
			}),
	);

export const signatureAfterOwnAppend = (
	stateBranchRoot: string,
	previous: string,
	fileName: string,
): string | null => {
	const before = entries(previous);
	const next = logSignature(stateBranchRoot);
	const after = entries(next);

	for (const [file, entry] of after) {
		if (file === fileName) continue;
		if (before.get(file) !== entry) return null;
	}

	// A file that was there and is gone is someone else's change too.
	for (const file of before.keys()) {
		if (file !== fileName && !after.has(file)) return null;
	}

	return next;
};

// What this process has both read and applied. Boot sets it once it has
// derived the board; a write advances it, because it already applied what it
// wrote. Anything else moving leaves it alone, and the next read derives.
let accounted: {root: string; signature: string} | null = null;

export const accountedSignature = (stateBranchRoot: string): string | null =>
	accounted && accounted.root === stateBranchRoot ? accounted.signature : null;

export const accountFor = (
	stateBranchRoot: string,
	signature: string,
): void => {
	accounted = {root: stateBranchRoot, signature};
};

export const noteOwnAppend = (
	stateBranchRoot: string,
	fileName: string,
): void => {
	if (!accounted || accounted.root !== stateBranchRoot) return;

	const next = signatureAfterOwnAppend(
		stateBranchRoot,
		accounted.signature,
		fileName,
	);

	// Null means someone else wrote too, and this process has not applied their
	// events — so it must forget what it thought it knew rather than claim it.
	accounted = next === null ? null : {root: stateBranchRoot, signature: next};
};

// The tests drive the log through mocks, so they need this gone between cases.
export const clearAccountedSignature = (): void => {
	accounted = null;
};
