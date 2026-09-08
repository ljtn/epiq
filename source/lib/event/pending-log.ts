import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';

/**
 * Where an append actually lands.
 *
 * The tracked log is a file git owns. To rebase, git stashes the working copy,
 * checks out the remote's version and puts the stash back — and a line written
 * while that is happening was in no stash, so the checkout writes over it. It
 * is not a merge going wrong: `*.jsonl merge=union` handles concurrent appends
 * correctly, but only for lines that are *committed*. An uncommitted line is
 * invisible to the merge and is simply overwritten.
 *
 * So appends go to a file git does not track. Git resets around it, and a sync
 * folds it into the tracked log once git is done with the worktree.
 *
 * The marker sits on the *id* segment, which is the one part of the name that
 * cannot contain a `.` — names can ("J. Lampa" becomes `<id>.j.-lampa`), so a
 * `.pending` suffix there would be indistinguishable from a contributor
 * actually called "pending". `~` survives no sanitising (`sanitizeFilePart`
 * maps everything outside `[a-z0-9._-]` to `-`), so no real id can end in one.
 *
 * The name still ends in `.jsonl`, which is what every reader globs for. That
 * is deliberate and load-bearing: `mintEventId` derives an event's causal
 * parent from the same directory, and an append it could not see would mint an
 * id sorting before its own parent.
 */
const PENDING_MARKER = '~pending';

// A rotated file keeps the marker and adds a unique suffix, so it is still
// read, still resolves to the same actor, and is still recognisably pending
// while a flush is part-way through it.
const PENDING_SEGMENT = /~pending(-[0-9a-z]+)?$/i;

/** `<id>.<name>.jsonl` -> `<id>~pending.<name>.jsonl`. */
export const toPendingFileName = (trackedFileName: string): string => {
	const separator = trackedFileName.indexOf('.');
	if (separator === -1) return `${trackedFileName}${PENDING_MARKER}`;

	return (
		trackedFileName.slice(0, separator) +
		PENDING_MARKER +
		trackedFileName.slice(separator)
	);
};

/** The tracked log a pending file belongs to, or null if it is not one. */
export const trackedFileNameFor = (fileName: string): string | null => {
	const separator = fileName.indexOf('.');
	const idSegment = separator === -1 ? fileName : fileName.slice(0, separator);

	if (!PENDING_SEGMENT.test(idSegment)) return null;

	return (
		idSegment.replace(PENDING_SEGMENT, '') +
		(separator === -1 ? '' : fileName.slice(separator))
	);
};

/**
 * The actor id a segment names, with any pending marker removed.
 *
 * The id is the one thing read off a log's file name — a display name never is,
 * since the name segment is a sanitized storage key that a rename leaves stale.
 * So this has to come off before the id is used, or a pending line resolves to
 * a contributor who does not exist.
 */
export const stripPendingMarker = (idSegment: string): string =>
	idSegment.replace(PENDING_SEGMENT, '');

export const isPendingFileName = (fileName: string): boolean =>
	fileName.endsWith('.jsonl') && trackedFileNameFor(fileName) !== null;

export const getPendingLogPath = (
	eventsRoot: string,
	trackedFileName: string,
): string =>
	path.join(getEventsDirPath(eventsRoot), toPendingFileName(trackedFileName));

/**
 * Folds every pending file into the tracked log it belongs to.
 *
 * Rotate, append, delete — in that order, and never truncate. Renaming first
 * means an append landing mid-flush creates a fresh pending file at the
 * original path rather than being erased; the rename is atomic, so no line
 * falls between the two. Appending before deleting means a crash leaves lines
 * in both files, and `getSortedEvents` dedupes by id, so a duplicate costs
 * nothing while a loss cannot be undone.
 *
 * A crash therefore leaves a rotated file behind, which is why this picks up
 * every pending file it finds rather than only the live one.
 *
 * Must run while this process holds the state worktree — it writes the tracked
 * log, which is exactly what a sync must not have happening underneath it.
 */
export const flushPendingLogs = (eventsRoot: string): Result<number> => {
	const dir = getEventsDirPath(eventsRoot);

	if (!fs.existsSync(dir)) return succeeded('No events directory', 0);

	try {
		const pending = fs
			.readdirSync(dir)
			.filter(name => name.endsWith('.jsonl'))
			.filter(isPendingFileName);

		let folded = 0;

		for (const name of pending) {
			const tracked = trackedFileNameFor(name);
			if (!tracked) continue;

			// One already carrying a unique suffix was left by a flush that did
			// not finish. Take it as it stands rather than rotating a rotation.
			const alreadyRotated = /~pending-/i.test(name);

			const rotated = alreadyRotated
				? name
				: toPendingFileName(tracked).replace(
						PENDING_MARKER,
						`${PENDING_MARKER}-${ulid().toLowerCase()}`,
				  );

			const rotatedPath = path.join(dir, rotated);

			if (!alreadyRotated) {
				fs.renameSync(path.join(dir, name), rotatedPath);
			}

			const content = fs.readFileSync(rotatedPath, 'utf8');

			if (content.trim().length > 0) {
				// Newline-terminated regardless of what the source ended with: a
				// joined pair of lines is two events lost, and union merge relies
				// on every line standing alone.
				const normalized = content.endsWith('\n') ? content : `${content}\n`;

				fs.appendFileSync(path.join(dir, tracked), normalized, 'utf8');
				folded += normalized.trimEnd().split('\n').length;
			}

			fs.rmSync(rotatedPath, {force: true});
		}

		return succeeded('Folded pending logs', folded);
	} catch (error) {
		return failed(
			`Unable to fold pending event logs in ${dir}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};
