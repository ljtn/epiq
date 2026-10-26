// Whether the log has moved: sizes and mtimes of every actor's file.
// Read it BEFORE the log, so a write landing in between is rebuilt next time.

import fs from 'node:fs';
import path from 'node:path';
import {getEventsDirPath} from '../storage/paths.js';

/**
 * A file listed a moment ago and gone now, as a sync renames pending logs.
 * Scans relist a few times, then treat it as absent.
 */
export const isVanished = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

export const SCAN_ATTEMPTS = 3;

export const listEventFiles = (dir: string): string[] =>
	fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.sort();

export const logSignature = (stateBranchRoot: string): string => {
	const dir = getEventsDirPath(stateBranchRoot);

	for (let attempt = 1; ; attempt++) {
		if (!fs.existsSync(dir)) return 'none';

		const parts: string[] = [];
		let listAgain = false;

		for (const file of listEventFiles(dir)) {
			try {
				const {size, mtimeMs} = fs.statSync(path.join(dir, file));
				parts.push(`${file}:${size}:${mtimeMs}`);
			} catch (error) {
				if (!isVanished(error)) throw error;
				if (attempt < SCAN_ATTEMPTS) {
					listAgain = true;
					break;
				}
			}
		}

		if (!listAgain) return parts.join('|');
	}
};

// The signature after this process's own append, or null when anything else
// moved: only our own write is already applied.
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
	/** What this process appended: anything more is another's line. */
	bytes: number,
): string | null => {
	const before = entries(previous);
	const next = logSignature(stateBranchRoot);
	const after = entries(next);

	// Every process of this actor writes this file; grown by more than this append, it holds unapplied lines.
	const sizeOf = (entry: string | undefined) =>
		entry === undefined ? 0 : Number(entry.slice(0, entry.indexOf(':')));
	if (sizeOf(after.get(fileName)) !== sizeOf(before.get(fileName)) + bytes) {
		return null;
	}

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

// What this process has read and applied: set at boot, advanced by its own writes.
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
	bytes: number,
): void => {
	if (!accounted || accounted.root !== stateBranchRoot) return;

	const next = signatureAfterOwnAppend(
		stateBranchRoot,
		accounted.signature,
		fileName,
		bytes,
	);

	// Null means someone else wrote too, and this process has not applied their
	// events — so it must forget what it thought it knew rather than claim it.
	accounted = next === null ? null : {root: stateBranchRoot, signature: next};
};

// Nothing is taken as applied until the next derive: after a write the state
// took but the log did not, and between test cases that mock the log.
export const clearAccountedSignature = (): void => {
	accounted = null;
};
