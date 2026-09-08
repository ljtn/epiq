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

// The id segment of a pending file is one of three shapes, all still read and
// all resolving to the same actor:
//
//   <id>~pending                 live: what `persist` appends to
//   <id>~pending-<ulid>          rotated: a flush has renamed it and is reading it
//   <id>~pending-<ulid>-f<bytes> folded: the first <bytes> are in the tracked log
const PENDING_SEGMENT = /~pending(-[0-9a-z]+)*$/i;

const FOLDED_SUFFIX = /-f(\d+)$/;

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

const splitName = (fileName: string): [string, string] => {
	const separator = fileName.indexOf('.');

	return separator === -1
		? [fileName, '']
		: [fileName.slice(0, separator), fileName.slice(separator)];
};

/** The tracked log a pending file belongs to, or null if it is not one. */
export const trackedFileNameFor = (fileName: string): string | null => {
	const [idSegment, rest] = splitName(fileName);

	if (!PENDING_SEGMENT.test(idSegment)) return null;

	return idSegment.replace(PENDING_SEGMENT, '') + rest;
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

/** How many leading bytes of a folded file are already in the tracked log. */
export const foldedBytesOf = (fileName: string): number | null => {
	const [idSegment] = splitName(fileName);
	const match = FOLDED_SUFFIX.exec(idSegment);

	return match && isPendingFileName(fileName) ? Number(match[1]) : null;
};

const rotatedFileName = (trackedFileName: string): string =>
	toPendingFileName(trackedFileName).replace(
		PENDING_MARKER,
		`${PENDING_MARKER}-${ulid().toLowerCase()}`,
	);

const foldedFileName = (rotatedName: string, bytes: number): string => {
	const [idSegment, rest] = splitName(rotatedName);

	return `${idSegment.replace(FOLDED_SUFFIX, '')}-f${bytes}${rest}`;
};

export const getPendingLogPath = (
	eventsRoot: string,
	trackedFileName: string,
): string =>
	path.join(getEventsDirPath(eventsRoot), toPendingFileName(trackedFileName));

/** Bytes not yet folded: all of a live or rotated file, the tail of a folded one. */
const unfoldedBytes = (filePath: string, name: string): number =>
	Math.max(0, fs.statSync(filePath).size - (foldedBytesOf(name) ?? 0));

/**
 * Whether any pending log holds lines that are in no tracked log yet.
 *
 * Pending logs are ignored, so `git status` does not list them — but they hold
 * every event written since the last sync, and a guard that asks git whether a
 * worktree still has unpublished work has to ask this too. Any actor's: the
 * worktree is shared, and the lines are somebody's either way. Unreadable
 * counts as held, for the same reason `findStrandedEventLogs` refuses.
 */
export const hasPendingLines = (eventsRoot: string): boolean => {
	const dir = getEventsDirPath(eventsRoot);

	try {
		if (!fs.existsSync(dir)) return false;

		return fs
			.readdirSync(dir)
			.filter(isPendingFileName)
			.some(name => unfoldedBytes(path.join(dir, name), name) > 0);
	} catch {
		return true;
	}
};

// Bounded for a filesystem whose inode numbers are not stable, where the check
// below could never agree and every append would otherwise loop.
const MAX_APPEND_ATTEMPTS = 3;

/**
 * Appends one line to a pending log, and makes sure it stays reachable.
 *
 * A flush rotates the pending file by renaming it. An append is open, write,
 * close, in a process holding no lock — and O_APPEND follows the inode, so a
 * writer preempted between its open and its write lands the line in a file the
 * flush has already read. So after writing, check that the path still leads to
 * the file written to; if not, write again to whatever is there now. A line
 * that lands in both is deduped by id.
 *
 * This is a belt, not the braces. The comparison is by inode number, and that
 * is not a sound oracle on its own: ext4 hands a freed number to the next file
 * created, and APFS can resolve a just-renamed path to the old inode for a
 * moment under concurrent lookups. What keeps the line safe is the flush never
 * deleting a file a writer could still reach — see `flushPendingLogs`.
 */
export const appendPendingLine = (filePath: string, line: string): void => {
	for (let attempt = 1; ; attempt++) {
		const fd = fs.openSync(filePath, 'a');
		let written: number;

		try {
			fs.writeSync(fd, line);
			written = fs.fstatSync(fd).ino;
		} finally {
			fs.closeSync(fd);
		}

		let current: number | null;
		try {
			current = fs.statSync(filePath).ino;
		} catch {
			current = null;
		}

		if (current === written || attempt >= MAX_APPEND_ATTEMPTS) return;
	}
};

/**
 * Whether the log can take an appended line as a line of its own. A file that
 * is missing or empty can; one whose last byte is not a newline ends in a
 * partial line — a crash mid-append, or a git truncation — and a line spliced
 * onto it would be lost with it. Reads one byte, not the file.
 */
const endsCleanly = (filePath: string): boolean => {
	let fd: number;
	try {
		fd = fs.openSync(filePath, 'r');
	} catch {
		return true;
	}

	try {
		const {size} = fs.fstatSync(fd);
		if (size === 0) return true;

		const last = Buffer.alloc(1);
		fs.readSync(fd, last, 0, 1, size - 1);

		return last[0] === 0x0a;
	} finally {
		fs.closeSync(fd);
	}
};

const NEWLINE = 0x0a;

/**
 * Appends the whole lines in `bytes` to the tracked log and returns how many
 * bytes that covered. A trailing fragment with no newline is a write still in
 * flight or a crash remnant; it is not a line yet, so it is left for the next
 * pass rather than spliced onto the log — unless this is the file's last pass
 * (`final`), when it is appended terminated: a fragment that old is a remnant,
 * and the loader's quarantine is the right place for it, not the bin.
 */
const foldLines = (
	trackedPath: string,
	bytes: Buffer,
	final = false,
): {bytes: number; lines: number} => {
	const end = final ? bytes.length : bytes.lastIndexOf(NEWLINE) + 1;
	if (end === 0) return {bytes: 0, lines: 0};

	const whole = bytes.subarray(0, end);
	if (whole.toString('utf8').trim().length === 0) return {bytes: end, lines: 0};

	// Newline-terminated on both sides: a joined pair of lines is two events
	// lost, and union merge relies on every line standing alone.
	fs.appendFileSync(
		trackedPath,
		Buffer.concat([
			Buffer.from(endsCleanly(trackedPath) ? '' : '\n'),
			whole,
			Buffer.from(whole[whole.length - 1] === NEWLINE ? '' : '\n'),
		]),
	);

	let lines = 0;
	for (const byte of whole) if (byte === NEWLINE) lines++;
	if (whole[whole.length - 1] !== NEWLINE) lines++;

	return {bytes: end, lines};
};

/**
 * Folds one actor's pending file(s) into the tracked log they belong to.
 *
 * Only the syncing actor's own. A sync commits only its own file, so folding
 * somebody else's pending lines would leave them dirty in a tracked file for
 * the whole rebase — in no commit and, since the snapshot skips pending logs,
 * in no snapshot either — which is the loss this file exists to prevent. Theirs
 * stay pending, out of git's reach, until they sync.
 *
 * Each pass moves a file one step along: live → rotated → folded → gone.
 *
 * Rotating first means an append landing after the rename creates a fresh live
 * file rather than being erased. Folding appends the whole lines read and
 * records how many bytes that was in the name, so the next pass can fold only
 * what arrived after. Deleting waits for that next pass, and that is the
 * load-bearing part: a writer can still reach a file that was just rotated — one
 * preempted between opening it and writing, or one whose path lookup resolved
 * to the old inode after the rename (measured on APFS under contention) — and
 * a file deleted while it is reachable takes those lines with it, on ext4 past
 * the writer's own inode check too, since the freed number goes to the next
 * file created. The rename to the folded name purges the stale lookup, the
 * file stays readable and attributed to the actor meanwhile, and by the next
 * sync nothing has held it open for seconds.
 *
 * Appending before renaming or deleting means a crash leaves lines in both
 * files, and `getSortedEvents` dedupes by id, so a duplicate costs nothing
 * while a loss cannot be undone. A crash therefore leaves a rotated or folded
 * file behind, which is why this picks up every pending file of the actor's
 * rather than only the live one.
 *
 * Must run while this process holds the state worktree — it writes the tracked
 * log, which is exactly what a sync must not have happening underneath it.
 */
export const flushPendingLogs = (
	eventsRoot: string,
	ownFileName: string,
): Result<number> => {
	const dir = getEventsDirPath(eventsRoot);

	if (!fs.existsSync(dir)) return succeeded('No events directory', 0);

	try {
		const pending = fs
			.readdirSync(dir)
			.filter(name => trackedFileNameFor(name) === ownFileName);

		const trackedPath = path.join(dir, ownFileName);
		let folded = 0;

		for (const name of pending) {
			const already = foldedBytesOf(name);

			if (already !== null) {
				// Folded on the previous pass: take whatever arrived since, then
				// it is safe to delete — nothing can reach it any more.
				const filePath = path.join(dir, name);
				const tail = fs.readFileSync(filePath).subarray(already);

				folded += foldLines(trackedPath, tail, true).lines;
				fs.rmSync(filePath, {force: true});
				continue;
			}

			// One already carrying a unique suffix was left by a flush that did
			// not finish. Take it as it stands rather than rotating a rotation.
			const rotated = /~pending-/i.test(name)
				? name
				: rotatedFileName(ownFileName);
			const rotatedPath = path.join(dir, rotated);

			if (rotated !== name) {
				fs.renameSync(path.join(dir, name), rotatedPath);
			}

			const result = foldLines(trackedPath, fs.readFileSync(rotatedPath));
			folded += result.lines;

			fs.renameSync(
				rotatedPath,
				path.join(dir, foldedFileName(rotated, result.bytes)),
			);
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
