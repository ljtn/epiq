// Reading one actor's log file into its events, and the cache that lets a
// file that only grew be read from where its last read stopped.

import {createHash, type Hash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {parsePersistedEnvelope, PersistedEnvelope} from './event-envelope.js';
import {Actor} from './event.model.js';
import {isSettledStamp, isVanished} from './log-signature.js';
import {stripPendingMarker} from './pending-log.js';

// The keys every persisted event carries besides its action.
export const ENVELOPE_KEYS = new Set(['id', 'v', 'userId', 'userName']);

export const UNNAMED_ACTOR = 'unknown';

const EventFileNameSchema = z.object({
	userId: z.string().min(1).default(UNNAMED_ACTOR),
	userName: z.string().min(1).default(UNNAMED_ACTOR),
});

// `v` is the version as written, maybe unsupported: an unreadable event keeps its place.
// `userName` is the older file names' segment, read by `loadActorNames`.
export type ReconstructedEvent = PersistedEnvelope & Actor & {userName: string};

// Orderable but not interpretable; `corrupt-line` has no envelope and is only
// reported. `targetNodeId` scopes the resulting lock.
export type UnreadableEvent = {
	eventId: string | null;
	reason:
		| 'unsupported-schema-version'
		| 'unknown-action'
		| 'invalid-payload'
		| 'corrupt-line';
	detail: string;
	targetNodeId: string | null;
};

// File names are lowercased but ULIDs are upper case; restores the casing of
// ULID-shaped ids only.
const ULID_SHAPE = /^[0-9a-hjkmnp-tv-z]{26}$/i;

const canonicalUserId = (userId: string): string =>
	ULID_SHAPE.test(userId) ? userId.toUpperCase() : userId;

export const parseEventFileActor = (
	filePath: string,
): Result<{userId: string; userName: string}> => {
	const baseName = path.basename(filePath, '.jsonl');

	// Split on the FIRST '.' only: names may contain dots, ids never do.
	const separatorIndex = baseName.indexOf('.');
	// A pending log's marker rides on the id segment; same actor either way.
	const userId = stripPendingMarker(
		separatorIndex === -1 ? baseName : baseName.slice(0, separatorIndex),
	);
	// Undefined, not '', so the schema's 'unknown' default applies rather than
	// tripping its min(1).
	const userName =
		separatorIndex === -1 ? undefined : baseName.slice(separatorIndex + 1);

	const result = EventFileNameSchema.safeParse({
		// Id only: the name segment is compared against a re-encoded (lowercased)
		// name, so changing its case would break that match.
		userId: canonicalUserId(userId),
		userName,
	});

	if (!result.success) {
		return failed(
			`Invalid event file name ${path.basename(filePath)}: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed event file actor', result.data);
};

// Parsed files, keyed by a stat stamp taken BEFORE the read, so a write landing
// in between is reparsed next time rather than cached as seen.
const NEWLINE = 0x0a;

// Parsed and decoded events are shared by every load that follows: the suites
// freeze them, so a caller that writes into one fails there.
export const FREEZE_EVENTS = process.env['EPIQ_FREEZE_EVENTS'] === '1';

export const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
};

type RememberedParse = {
	stamp: string;
	entries: ReconstructedEvent[];
	quarantined: UnreadableEvent[];
	// What was parsed: its length and lines, and a hash, so a file that only
	// grew is parsed from where this stopped.
	bytes: number;
	lines: number;
	hash: string;
	// The hash's state after those bytes, so the next only adds what is new.
	hasher: Hash;
	// Whether those bytes end on a line break, so an append starts a line.
	endsWithBreak: boolean;
	// Kept by every parse that only adds to this one, new for one parsed whole:
	// the same lineage means the entries before are the same entries.
	lineage: number;
	// Trusted by its stamp alone only once settled; the hash check makes any
	// remembered parse a sound base for the next.
	settled: boolean;
};

// Every file the last scan read, and nothing else: the ordered log keeps every
// entry alive whatever this holds. Should it stop holding them all, this needs
// a cap.
const parseCache = new Map<string, RememberedParse>();

let lastLineage = 0;
const newLineage = (): number => ++lastLineage;

const rememberParse = (filePath: string, next: RememberedParse): void => {
	parseCache.set(filePath, next);
};

// Forgets every file but those a scan just read: another board's, or one gone.
export const keepParsesOf = (read: ReadonlySet<string>): void => {
	for (const filePath of parseCache.keys()) {
		if (!read.has(filePath)) parseCache.delete(filePath);
	}
};

const hashOf = (bytes: Buffer | string): string =>
	createHash('sha1').update(bytes).digest('hex');

const digestOf = (hasher: Hash): string => hasher.copy().digest('hex');

/** The tests drive the log through mocks, where a stamp says nothing. */
export const clearParseCache = (): void => {
	parseCache.clear();
};

const MS_IN_NS = 1_000_000n;
const SECOND_IN_NS = 1_000_000_000n;

type FileStamp = {value: string; settled: boolean};

const fileStamp = (filePath: string): FileStamp | null => {
	try {
		const {size, mtimeNs} = fs.statSync(filePath, {bigint: true});

		return {
			value: `${size}:${mtimeNs}`,
			settled: isSettledStamp(
				Number(BigInt(Date.now()) * MS_IN_NS - mtimeNs) / 1e6,
				mtimeNs % SECOND_IN_NS === 0n,
			),
		};
	} catch {
		return null;
	}
};

/** The lineage of the parse returned, or null where none was remembered. */
export type ParseLineage = {lineage: number | null};

/**
 * The parse of `filePath` after appending `line`, from the parse held of it,
 * without reading it: null when what is held is not the file before it. The
 * hash keeps it honest: a file that is not what was hashed is parsed whole.
 */
export const extendParse = (
	filePath: string,
	line: string,
): {
	entry: ReconstructedEvent;
	base: RememberedParse | undefined;
	lineage: number;
} | null => {
	const actor = parseEventFileActor(filePath);
	const stamp = fileStamp(filePath);
	if (isFail(actor) || !stamp) return null;

	const appended = Buffer.from(line);
	const size = Number(stamp.value.slice(0, stamp.value.indexOf(':')));
	const held = parseCache.get(filePath);
	const before = held?.bytes ?? 0;
	if (
		!line.endsWith('\n') ||
		before + appended.length !== size ||
		(held && !held.endsWithBreak)
	) {
		return null;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(line);
	} catch {
		return null;
	}
	const envelope = parsePersistedEnvelope(raw);
	if (isFail(envelope)) return null;

	const entry: ReconstructedEvent = {
		...envelope.value,
		userId: actor.value.userId,
		userName: actor.value.userName,
	};
	const hasher = (held ? held.hasher.copy() : createHash('sha1')).update(
		appended,
	);
	const lineage = held?.lineage ?? newLineage();
	rememberParse(filePath, {
		stamp: stamp.value,
		entries: [...(held?.entries ?? []), entry],
		quarantined: held?.quarantined ?? [],
		bytes: size,
		lines: (held?.lines ?? 0) + 1,
		endsWithBreak: true,
		lineage,
		hash: digestOf(hasher),
		hasher,
		settled: stamp.settled,
	});

	return {entry, base: held, lineage};
};

/**
 * The events in `text`, a run of lines from one actor's file starting after
 * line `firstLine`, each with its trimmed line; and those that do not parse.
 */
const parseLines = (
	text: string,
	fileName: string,
	firstLine: number,
	actor: {userId: string; userName: string},
): {
	entries: Array<{entry: ReconstructedEvent; line: string}>;
	quarantined: UnreadableEvent[];
} => {
	const entries: Array<{entry: ReconstructedEvent; line: string}> = [];
	const quarantined: UnreadableEvent[] = [];

	// An unparseable envelope has no id to keep its place: skip the line, never
	// fail the load, as union merge spreads it to every clone.
	const quarantine = (lineNumber: number, reason: string) => {
		quarantined.push({
			eventId: null,
			reason: 'corrupt-line',
			detail: `${fileName}:${lineNumber} (${reason})`,
			targetNodeId: null,
		});
	};

	for (const [index, line] of text.split('\n').entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			quarantine(firstLine + index + 1, 'invalid JSON');
			continue;
		}

		// Envelope only: an unreadable version is retained for its place in the
		// chain.
		const parsedResult = parsePersistedEnvelope(raw);
		if (isFail(parsedResult)) {
			quarantine(firstLine + index + 1, parsedResult.message);
			continue;
		}

		const entry: ReconstructedEvent = {
			...parsedResult.value,
			userId: actor.userId,
			userName: actor.userName,
		};
		entries.push({
			entry: FREEZE_EVENTS ? deepFreeze(entry) : entry,
			line: trimmed,
		});
	}

	return {entries, quarantined};
};

/** Null when the file is not there — listed a moment ago, perhaps, and gone now. */

export const parsePersistedEventsFile = (
	filePath: string,
	unreadable?: UnreadableEvent[],
	seen?: ParseLineage,
): Result<ReconstructedEvent[] | null> => {
	if (seen) seen.lineage = null;
	const actorResult = parseEventFileActor(filePath);
	if (isFail(actorResult)) return failed(actorResult.message);

	const stamp = fileStamp(filePath);
	const remembered = stamp ? parseCache.get(filePath) : undefined;

	if (stamp && remembered?.settled && remembered.stamp === stamp.value) {
		// Appended one at a time rather than spread: a log can hold more lines
		// than an argument list has room for, and a corrupt one holds them here.
		if (unreadable)
			for (const entry of remembered.quarantined) {
				unreadable.push(entry);
			}

		if (seen) seen.lineage = remembered.lineage;

		// A copy of the list, so a caller sorting it cannot reorder the cache.
		return succeeded('Parsed persisted events file', [...remembered.entries]);
	}

	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(filePath);
	} catch (error) {
		if (isVanished(error)) return succeeded('Event file missing', null);
		throw error;
	}

	const fileName = path.basename(filePath);

	// Only grown: the bytes parsed before are still the file's start and end
	// on a line break, so only what follows them is new.
	const grown =
		remembered &&
		bytes.length >= remembered.bytes &&
		remembered.endsWithBreak &&
		hashOf(bytes.subarray(0, remembered.bytes)) === remembered.hash
			? remembered
			: undefined;

	const from = grown?.bytes ?? 0;
	const text = bytes.subarray(from).toString('utf8');
	const entries: ReconstructedEvent[] = grown ? [...grown.entries] : [];
	// Collected separately from the caller's list so the entry can be remembered
	// with the events it belongs to, and replayed on a hit.
	const quarantined: UnreadableEvent[] = grown ? [...grown.quarantined] : [];
	const firstLine = grown?.lines ?? 0;

	const parsed = parseLines(text, fileName, firstLine, actorResult.value);
	for (const {entry} of parsed.entries) entries.push(entry);
	for (const entry of parsed.quarantined) quarantined.push(entry);
	const lines = text.split('\n');

	if (unreadable) for (const entry of quarantined) unreadable.push(entry);

	// Remembered with any readable stamp. Lines so far: all but the piece after
	// the last break, which a later append continues.
	if (stamp) {
		const hasher = (grown ? grown.hasher.copy() : createHash('sha1')).update(
			bytes.subarray(from),
		);
		const lineage = grown?.lineage ?? newLineage();
		rememberParse(filePath, {
			stamp: stamp.value,
			entries,
			quarantined,
			lineage,
			bytes: bytes.length,
			lines: firstLine + lines.length - 1,
			hash: digestOf(hasher),
			hasher,
			endsWithBreak: bytes.length === 0 || bytes.at(-1) === NEWLINE,
			settled: stamp.settled,
		});
		if (seen) seen.lineage = lineage;
	}

	return succeeded('Parsed persisted events file', [...entries]);
};
