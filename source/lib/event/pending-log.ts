import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';

/**
 * Appends go to an untracked file a sync folds in, as a rebase overwrites
 * uncommitted lines. The marker sits on the id segment, which never holds `.`
 * or `~`; the name still ends in `.jsonl` so readers see it.
 */
const PENDING_MARKER = '~pending';

// Pending id segments, all the same actor:
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

/** The actor id a segment names, with any pending marker removed. */
export const stripPendingMarker = (idSegment: string): string =>
	idSegment.replace(PENDING_SEGMENT, '');

export const isPendingFileName = (fileName: string): boolean =>
	fileName.endsWith('.jsonl') && trackedFileNameFor(fileName) !== null;

/** The actor a log file name belongs to: its id segment, marker stripped. */
export const actorSegmentOf = (fileName: string): string =>
	stripPendingMarker(splitName(fileName)[0]);

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
 * Whether any actor's pending log holds lines in no tracked log yet; git status
 * cannot see them. Unreadable counts as held.
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
 * Appends a line, rewriting it if a flush rotated the file meanwhile (deduped
 * by id). Only a belt: inode checks are unsound, see `flushPendingLogs`.
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

/** Whether the log ends in a newline (or is empty), so an append starts a fresh line. */
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
 * Appends the whole lines in `bytes` and returns the bytes covered. A trailing
 * fragment waits for the next pass, unless `final`.
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
 * Folds this actor's pending files into its log (holding the state worktree),
 * one step per pass: live → rotated → folded → gone. Deletion waits a pass,
 * since a writer may still hold a just-rotated file.
 */
export const flushPendingLogs = (
	eventsRoot: string,
	ownFileName: string,
): Result<number> => {
	const dir = getEventsDirPath(eventsRoot);

	if (!fs.existsSync(dir)) return succeeded('No events directory', 0);

	try {
		// Matched by actor, so an older `<id>~pending.<name>.jsonl` folds into the current log.
		const own = actorSegmentOf(ownFileName);
		const pending = fs
			.readdirSync(dir)
			.filter(name => isPendingFileName(name) && actorSegmentOf(name) === own);

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
