import {createHash, type Hash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {decodeTime, toEffectiveUlidTimes} from './date-utils.js';
import {EventCatalog} from './event-catalog.js';
import {
	isSupportedSchemaVersion,
	parsePersistedEnvelope,
	PersistedEnvelope,
} from './event-envelope.js';
import {ActionOf, Actor, Event, EventMap} from './event.model.js';
import {
	isSettledSignature,
	isSettledStamp,
	isVanished,
	listEventFiles,
	logSignature,
	SCAN_ATTEMPTS,
	signatureAfterOwnAppend,
} from './log-signature.js';
import {stripPendingMarker} from './pending-log.js';

// The actor name a log file name without a name segment yields.
const UNNAMED_ACTOR = 'unknown';

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

const ENVELOPE_KEYS = new Set(['id', 'v', 'userId', 'userName']);

// Anything ambiguous returns null, falling back to a log-wide lock.
const getTargetNodeId = (entry: ReconstructedEvent): string | null => {
	const payloads = Object.entries(entry).filter(
		([key]) => !ENVELOPE_KEYS.has(key),
	);

	// Unchecked here: more than one key means the action is unknown.
	if (payloads.length !== 1) return null;

	const value = payloads[0]?.[1];
	if (typeof value !== 'object' || value === null) return null;

	const candidate = (value as {id?: unknown}).id;

	return typeof candidate === 'string' && candidate.length > 0
		? candidate
		: null;
};

// File names are lowercased but ULIDs are upper case; restores the casing of
// ULID-shaped ids only.
const ULID_SHAPE = /^[0-9a-hjkmnp-tv-z]{26}$/i;

const canonicalUserId = (userId: string): string =>
	ULID_SHAPE.test(userId) ? userId.toUpperCase() : userId;

const parseEventFileActor = (
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

// The one key that is not the envelope's, counted without copying the entry.
const actionBesides = (
	entry: object,
	envelope: ReadonlySet<string>,
): Result<string> => {
	let action: string | undefined;
	let count = 0;

	for (const key of Object.keys(entry)) {
		if (envelope.has(key)) continue;
		count++;
		action = key;
	}

	if (count !== 1) {
		return failed(
			`Invalid persisted event: expected exactly 1 action key, got ${count}`,
		);
	}

	if (!action) {
		return failed('Invalid persisted event: action key is missing or invalid');
	}
	return succeeded('Resolved persisted action', action);
};

const PERSISTED_KEYS = new Set(['id', 'v']);

export const getPersistedAction = (entry: object): Result<string> =>
	actionBesides(entry, PERSISTED_KEYS);

const hasPersistedActionPayload = (
	entry: object,
	action: string,
): entry is Record<string, unknown> => action in entry;

// Parsed files, keyed by a stat stamp taken BEFORE the read, so a write landing
// in between is reparsed next time rather than cached as seen.
const NEWLINE = 0x0a;

// Parsed and decoded events are shared by every load that follows: the suites
// freeze them, so a caller that writes into one fails there.
const FREEZE_EVENTS = process.env['EPIQ_FREEZE_EVENTS'] === '1';

const deepFreeze = <T>(value: T): T => {
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

// No cap on lines: the ordered log keeps every entry alive whatever this
// holds. Should it stop holding them all, this needs a cap again.
const parseCache = new Map<string, RememberedParse>();
const PARSE_CACHE_MAX_FILES = 512;

let lastLineage = 0;
const newLineage = (): number => ++lastLineage;

// Whether it was kept: a full cache turns a new file away rather than evicting
// one, as loads read files in one order and would evict the next file read.
const rememberParse = (filePath: string, next: RememberedParse): boolean => {
	if (!parseCache.has(filePath) && parseCache.size >= PARSE_CACHE_MAX_FILES) {
		return false;
	}

	parseCache.set(filePath, next);
	return true;
};

const hashOf = (bytes: Buffer): string =>
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
const extendParse = (
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
	const kept = rememberParse(filePath, {
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

	return kept ? {entry, base: held, lineage} : null;
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

	const lines = text.split('\n');
	for (const [index, line] of lines.entries()) {
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
			userId: actorResult.value.userId,
			userName: actorResult.value.userName,
		};
		entries.push(FREEZE_EVENTS ? deepFreeze(entry) : entry);
	}

	if (unreadable) for (const entry of quarantined) unreadable.push(entry);

	// Remembered with any readable stamp. Lines so far: all but the piece after
	// the last break, which a later append continues.
	if (stamp) {
		const hasher = (grown ? grown.hasher.copy() : createHash('sha1')).update(
			bytes.subarray(from),
		);
		const lineage = grown?.lineage ?? newLineage();
		const kept = rememberParse(filePath, {
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
		if (seen && kept) seen.lineage = lineage;
	}

	return succeeded('Parsed persisted events file', [...entries]);
};

// Code units, not `localeCompare`, which follows the process locale.
const byCodeUnit = (a: string, b: string): number =>
	a < b ? -1 : a > b ? 1 : 0;

/**
 * Total, so order depends only on the event set: equal ids fall through to the
 * actor and payload, which every replica has identically.
 */
const compareEvents = (
	a: ReconstructedEvent,
	b: ReconstructedEvent,
): number => {
	const byId = byCodeUnit(a.id[0], b.id[0]);
	if (byId !== 0) return byId;

	return byCodeUnit(JSON.stringify(a), JSON.stringify(b));
};

/**
 * The causal order: a forest by `refId`, siblings by id, walked depth-first.
 * `genesis` names the only action allowed to be a root.
 */
export const sortEvents = (
	reconstructedEvents: ReconstructedEvent[],
	genesis: string,
): ReconstructedEvent[] =>
	sortEventsIndexed(reconstructedEvents, genesis).sorted;

// Per file the held order was read from: the parse lineage, and how many of
// its entries it holds. Null lineage: nothing to grow from, so sort again.
type HeldFiles = Map<string, {lineage: number | null; count: number}>;

// What each file holds past what the held order took from it: null unless
// every file it took from is still there, and has only grown since.
const addedSince = (
	heldFiles: HeldFiles,
	read: ReadonlyArray<{
		file: string;
		entries: ReconstructedEvent[];
		lineage: number | null;
	}>,
): ReconstructedEvent[] | null => {
	const now = new Map(read.map(entry => [entry.file, entry]));
	for (const [file, was] of heldFiles) {
		const is = now.get(file);
		if (
			!is ||
			was.lineage === null ||
			is.lineage !== was.lineage ||
			is.entries.length < was.count
		) {
			return null;
		}
	}

	const added: ReconstructedEvent[] = [];
	for (const {file, entries} of read) {
		for (let at = heldFiles.get(file)?.count ?? 0; at < entries.length; at++) {
			added.push(entries[at]!);
		}
	}
	return added;
};

export type OrderIndex = {
	ids: Map<string, number>;
	waiting: Set<string>;
	spine: ReconstructedEvent[] | null;
};

/**
 * Where `added` lands when it all lands after the order `index` describes: in
 * the order a full sort gives it, and the spine after it. Null otherwise, and
 * only a full sort is exact.
 */
export const appendToOrder = (
	index: OrderIndex,
	added: ReadonlyArray<ReconstructedEvent>,
): {order: ReconstructedEvent[]; spine: ReconstructedEvent[]} | null => {
	const {ids, waiting, spine} = index;
	if (!spine) return null;

	// Searched from the end: a new event's parent is nearly always the tail.
	const depthOf = (id: string): number => {
		for (let depth = spine.length - 1; depth >= 0; depth--) {
			if (spine[depth]!.id[0] === id) return depth;
		}
		return -1;
	};

	const newIds = new Set<string>();
	for (const entry of added) {
		const id = entry.id[0];
		// New, and nothing held waits on it: else it would sort in among them.
		if (ids.has(id) || waiting.has(id) || newIds.has(id)) return null;
		newIds.add(id);
	}

	const childrenOf = new Map<string, ReconstructedEvent[]>();
	const spineParents = new Map<string, number>();
	for (const entry of added) {
		const parent = entry.id[1];
		if (!parent) return null;

		if (!newIds.has(parent)) {
			// Under a held event: only on the spine, and after the child the
			// tail hangs from, or it sorts in among what is held.
			const depth = depthOf(parent);
			if (depth < 0) return null;
			const next = spine[depth + 1];
			if (next && compareEvents(entry, next) <= 0) return null;
			spineParents.set(parent, depth);
		}

		const siblings = childrenOf.get(parent) ?? [];
		siblings.push(entry);
		childrenOf.set(parent, siblings);
	}
	for (const siblings of childrenOf.values()) siblings.sort(compareEvents);

	// Deepest first: a full sort reaches a spine node's later children only
	// after everything below its path.
	const order: ReconstructedEvent[] = [];
	const parentIn = new Map<string, ReconstructedEvent>();
	const deepestFirst = [...spineParents].sort((a, b) => b[1] - a[1]);
	for (const [parent] of deepestFirst) {
		const stack = [...childrenOf.get(parent)!].reverse();
		while (stack.length > 0) {
			const entry = stack.pop()!;
			order.push(entry);
			for (const child of [...(childrenOf.get(entry.id[0]) ?? [])].reverse()) {
				parentIn.set(child.id[0], entry);
				stack.push(child);
			}
		}
	}

	// A new event under one that never landed hangs off nothing held.
	if (order.length !== added.length) return null;
	if (order.length === 0) return {order, spine};

	// The new tail's path, back up to where it joins the old spine.
	const path: ReconstructedEvent[] = [];
	let at: ReconstructedEvent | undefined = order.at(-1);
	while (at && newIds.has(at.id[0])) {
		path.push(at);
		at = parentIn.get(at.id[0]);
	}
	const joinedAt = spineParents.get(path.at(-1)!.id[1]!)!;
	const next = [...spine.slice(0, joinedAt + 1), ...path.reverse()];

	return {
		order,
		spine: next.length > SPINE_LIMIT ? next.slice(-SPINE_LIMIT) : next,
	};
};

// How many of the tail's ancestors are kept: an event appended under a deeper
// one is declined, and the order is sorted again.
const SPINE_LIMIT = 4096;

// The tail's nearest ancestors, nearest last: an event appended under one of
// them sorts last. None where the tail closed a cycle, which only a sort orders.
const spineOf = (
	events: ReconstructedEvent[],
	parentOf: Int32Array,
	placedAt: Int32Array,
	tail: number,
	tailPhase: number,
): ReconstructedEvent[] | null => {
	if (tail < 0 || tailPhase > 2) return null;

	const path: ReconstructedEvent[] = [];
	let at = tail;
	while (path.length < SPINE_LIMIT) {
		path.push(events[at]!);
		const parent = parentOf[at]!;
		if (parent < 0) break;
		at = placedAt[parent]!;
	}

	return path.reverse();
};

/**
 * The causal order, with the ids it holds and the parents it names but does
 * not hold: what an append to it has to check, built on the way.
 */
export const sortEventsIndexed = (
	reconstructedEvents: ReconstructedEvent[],
	genesis: string,
): {
	sorted: ReconstructedEvent[];
	ids: Map<string, number>;
	waiting: Set<string>;
	spine: ReconstructedEvent[] | null;
} => {
	const events = reconstructedEvents;
	const count = events.length;

	// Ids as numbers, one per distinct id: a duplicate shares its number.
	const idNumbers = new Map<string, number>();
	const idOf = new Int32Array(count);
	for (let index = 0; index < count; index++) {
		const eventId = events[index]!.id[0];
		let number = idNumbers.get(eventId);
		if (number === undefined) {
			number = idNumbers.size;
			idNumbers.set(eventId, number);
		}
		idOf[index] = number;
	}

	const NO_PARENT = -1;
	const UNKNOWN_PARENT = -2;
	const parentOf = new Int32Array(count);
	const childCounts = new Int32Array(idNumbers.size + 1);
	const waiting = new Set<string>();
	for (let index = 0; index < count; index++) {
		const refId = events[index]!.id[1] ?? null;
		const parent =
			refId === null ? NO_PARENT : idNumbers.get(refId) ?? UNKNOWN_PARENT;
		parentOf[index] = parent;
		if (parent >= 0) childCounts[parent + 1]!++;
		else if (parent === UNKNOWN_PARENT) waiting.add(refId!);
	}

	// Each id's children are childIndex[childStart[id] .. childStart[id + 1]].
	const childStart = childCounts;
	for (let id = 1; id < childStart.length; id++) {
		childStart[id]! += childStart[id - 1]!;
	}
	const childIndex = new Int32Array(childStart[idNumbers.size]!);
	const filled = childStart.slice(0, idNumbers.size);
	for (let index = 0; index < count; index++) {
		const parent = parentOf[index]!;
		if (parent >= 0) childIndex[filled[parent]!++] = index;
	}

	const byEvent = (a: number, b: number) =>
		compareEvents(events[a]!, events[b]!);
	for (let id = 0; id < idNumbers.size; id++) {
		const from = childStart[id]!;
		const to = childStart[id + 1]!;
		if (to - from > 1) childIndex.subarray(from, to).sort(byEvent);
	}

	const result: ReconstructedEvent[] = [];
	const placed = new Uint8Array(idNumbers.size);
	// Where each id was placed, and the phase the tail was placed in.
	const placedAt = new Int32Array(idNumbers.size);
	let tail = -1;
	let phase = 0;
	// Each event is pushed once by its parent, plus the root.
	const stack = new Int32Array(count + 1);

	// An explicit stack: the forest is one chain as long as the log.
	const visit = (root: number) => {
		let top = 0;
		stack[top++] = root;

		while (top > 0) {
			const index = stack[--top]!;
			const id = idOf[index]!;

			if (placed[id]) continue;

			result.push(events[index]!);
			placed[id] = 1;
			placedAt[id] = index;
			tail = index;

			// Reversed, so the lowest-ULID sibling is popped first.
			for (
				let child = childStart[id + 1]! - 1;
				child >= childStart[id]!;
				child--
			) {
				stack[top++] = childIndex[child]!;
			}
		}
	};

	const sortedIndexes = (keep: (index: number) => boolean): number[] => {
		const kept: number[] = [];
		for (let index = 0; index < count; index++)
			if (keep(index)) kept.push(index);
		return kept.sort(byEvent);
	};

	// Only genesis may be a root: a forged `refId: null` would sort before history.
	// Exactly one action key, or extra keys smuggle a payload past the check.
	const roots = sortedIndexes(index => {
		if (parentOf[index] !== NO_PARENT) return false;
		const keys = Object.keys(events[index]!).filter(
			key => !ENVELOPE_KEYS.has(key),
		);
		return keys.length === 1 && keys[0] === genesis;
	});
	phase = 1;
	for (const root of roots) visit(root);

	const orphanRoots = sortedIndexes(
		index => !placed[idOf[index]!] && parentOf[index]! < 0,
	);
	phase = 2;
	for (const orphanRoot of orphanRoots) visit(orphanRoot);

	const remaining = sortedIndexes(index => !placed[idOf[index]!]);
	const tailPhase = phase;
	phase = 3;
	for (const index of remaining) visit(index);

	return {
		sorted: result,
		ids: idNumbers,
		waiting,
		spine: spineOf(
			events,
			parentOf,
			placedAt,
			remaining.length > 0 ? -1 : tail,
			tailPhase,
		),
	};
};

// The time a checkout cut judges each event by: raw where honest, inherited
// where poisoned. Computed once, so every consumer agrees.
export const effectiveEventTimes = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
): Array<number | null> =>
	toEffectiveUlidTimes(
		events.map(event => {
			try {
				return decodeTime(event.id[0]);
			} catch {
				return null;
			}
		}),
	);

/** A causal order's ids as numbers and each event's parent as one, for cuts. */
export type CutIndex = {
	times: ReadonlyArray<number | null>;
	idOf: Int32Array;
	parentOf: Int32Array;
	ids: number;
};

// A parent the order does not hold, which never excludes its child.
const NO_PARENT = -1;

export const indexForCuts = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
): CutIndex => {
	const numbers = new Map<string, number>();
	const idOf = new Int32Array(events.length);
	for (let index = 0; index < events.length; index++) {
		const id = events[index]!.id[0];
		let number = numbers.get(id);
		if (number === undefined) {
			number = numbers.size;
			numbers.set(id, number);
		}
		idOf[index] = number;
	}

	const parentOf = new Int32Array(events.length);
	for (let index = 0; index < events.length; index++) {
		const refId = events[index]!.id[1];
		parentOf[index] = refId ? numbers.get(refId) ?? NO_PARENT : NO_PARENT;
	}

	return {
		times: effectiveEventTimes(events),
		idOf,
		parentOf,
		ids: numbers.size,
	};
};

/**
 * The index for `events`, which are `index`'s events plus a chain appended to
 * their tail, each new: what own writes add. Null for anything else, which
 * needs `indexForCuts`.
 */
export const extendCutIndex = (
	index: CutIndex,
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
	from: number,
): CutIndex | null => {
	const idOf = new Int32Array(events.length);
	const parentOf = new Int32Array(events.length);
	idOf.set(index.idOf.subarray(0, from));
	parentOf.set(index.parentOf.subarray(0, from));
	let ids = index.ids;

	for (let position = from; position < events.length; position++) {
		const [id, refId] = events[position]!.id;
		if (position === 0 || refId !== events[position - 1]!.id[0]) return null;

		for (let earlier = 0; earlier < position; earlier++) {
			const [otherId, otherRef] = events[earlier]!.id;
			if (otherId === id || otherRef === id) return null;
		}

		idOf[position] = ids++;
		parentOf[position] = idOf[position - 1]!;
	}

	return {times: effectiveEventTimes(events), idOf, parentOf, ids};
};

/**
 * Which events a cut at `targetTime` applies, by index into the causal order:
 * those before it whose parent it also applies.
 */
export const appliedAtTime = (
	events: ReadonlyArray<Pick<ReconstructedEvent, 'id'>>,
	targetTime: number,
	index: CutIndex = indexForCuts(events),
): Uint8Array => {
	const {times, idOf, parentOf} = index;
	const excluded = new Uint8Array(index.ids);
	const applied = new Uint8Array(events.length);

	for (let position = 0; position < events.length; position++) {
		const time = times[position] ?? null;
		const parent = parentOf[position]!;

		if (
			time === null ||
			time >= targetTime ||
			(parent !== NO_PARENT && excluded[parent])
		) {
			excluded[idOf[position]!] = 1;
		} else {
			applied[position] = 1;
		}
	}

	return applied;
};

export const splitEventsAtTime = (
	events: ReconstructedEvent[],
	targetTime: number,
): {
	appliedEvents: ReconstructedEvent[];
	unappliedEvents: ReconstructedEvent[];
} => {
	const applied = appliedAtTime(events, targetTime);

	return {
		appliedEvents: events.filter((_, index) => applied[index]),
		unappliedEvents: events.filter((_, index) => !applied[index]),
	};
};

/** Reads the log for one catalog: its actions, payload checks and genesis. */
export const createLoader = <M extends EventMap>(catalog: EventCatalog<M>) => {
	const knownActions: ReadonlySet<string> = new Set(catalog.actions);

	const isKnownAction = (action: string): action is ActionOf<M> =>
		knownActions.has(action);

	const fromPersistedEvent = (entry: ReconstructedEvent): Result<Event<M>> => {
		const actionResult = actionBesides(entry, ENVELOPE_KEYS);
		if (isFail(actionResult)) {
			return failed(actionResult.message);
		}

		const action = actionResult.value;
		const eventId = entry.id?.[0];
		if (!eventId) {
			return failed('Persisted event is missing id');
		}

		if (!hasPersistedActionPayload(entry, action)) {
			return failed(`Persisted event is missing payload for action: ${action}`);
		}

		// `userName` is dropped, so a replayed event equals the one applied in place.
		return succeeded('Decoded persisted event', {
			id: eventId,
			action,
			payload: entry[action],
			userId: entry.userId,
		} as Event<M>);
	};

	const decodeReconstructedEvents = (
		events: ReconstructedEvent[],
		unreadable?: UnreadableEvent[],
	): Result<Event<M>[]> => {
		const decoded: Event<M>[] = [];
		const skippedActions = new Map<string, number>();
		const skippedVersions = new Map<number, number>();

		for (const entry of events) {
			// Skipped after ordering, so the event keeps its place in history.
			if (!isSupportedSchemaVersion(entry.v)) {
				skippedVersions.set(entry.v, (skippedVersions.get(entry.v) ?? 0) + 1);
				unreadable?.push({
					eventId: entry.id[0],
					reason: 'unsupported-schema-version',
					detail: `v${entry.v}`,
					targetNodeId: getTargetNodeId(entry),
				});
				continue;
			}

			const eventResult = fromPersistedEvent(entry);

			// Quarantined, not fatal: union merge spreads a bad line to every clone.
			if (isFail(eventResult)) {
				unreadable?.push({
					eventId: entry.id[0],
					reason: 'invalid-payload',
					detail: eventResult.message,
					targetNodeId: getTargetNodeId(entry),
				});
				continue;
			}

			// An action from a newer build is skipped; the log is untouched, so upgrading restores it.
			const action = eventResult.value.action as string;
			if (!isKnownAction(action)) {
				skippedActions.set(action, (skippedActions.get(action) ?? 0) + 1);
				unreadable?.push({
					eventId: entry.id[0],
					reason: 'unknown-action',
					detail: action,
					targetNodeId: getTargetNodeId(entry),
				});
				continue;
			}

			// A known action's payload is checked before any materializer sees it.
			const payloadResult = catalog.readPayload(
				action,
				eventResult.value.payload,
			);
			if (isFail(payloadResult)) {
				unreadable?.push({
					eventId: entry.id[0],
					reason: 'invalid-payload',
					detail: payloadResult.message,
					targetNodeId: getTargetNodeId(entry),
				});
				continue;
			}

			decoded.push(
				FREEZE_EVENTS ? deepFreeze(eventResult.value) : eventResult.value,
			);
		}

		if (skippedActions.size > 0) {
			const summary = [...skippedActions.entries()]
				.map(([action, count]) => `${action} (x${count})`)
				.join(', ');
			logger.info(
				`Skipped events with unknown actions, likely created by a newer epiq version: ${summary}. Upgrade to apply them.`,
			);
		}

		if (skippedVersions.size > 0) {
			const summary = [...skippedVersions.entries()]
				.map(([version, count]) => `v${version} (x${count})`)
				.join(', ');
			logger.info(
				`Skipped events with unsupported schema versions, created by a newer epiq version: ${summary}. Upgrade to apply them.`,
			);
		}

		return succeeded('Decoded reconstructed events', decoded);
	};

	// The tail of the causal order, which every write points at. Cached by log
	// signature: deriving it means reading the whole log.
	let edgeCache: {root: string; signature: string; edge: string | null} | null =
		null;

	// The whole ordered log, by signature: a time-travel scrub and the timeline
	// read it again after every boot, unchanged.
	// The array the last load's order was copied from: the held order, which
	// only ever grows in place, or a fresh sort.
	let lastOrder: ReconstructedEvent[] | null = null;

	// That order decoded, as far as `length`: the order growing past it needs
	// only its new entries decoded.
	let decodedCache: {
		order: ReconstructedEvent[];
		length: number;
		events: Event<M>[];
		unreadable: UnreadableEvent[];
	} | null = null;

	let sortedCache: {
		root: string;
		signature: string;
		sorted: ReconstructedEvent[];
		quarantined: UnreadableEvent[];
		// From the sort: every id held, and every parent a held entry names
		// that is not one of them.
		ids: Map<string, number>;
		waiting: Set<string>;
		spine: ReconstructedEvent[] | null;
		files: HeldFiles;
	} | null = null;

	function loadAllPersistedEvents(
		eventsRoot: string,
		unreadable?: UnreadableEvent[],
	): Result<ReconstructedEvent[]> {
		const dir = getEventsDirPath(eventsRoot);

		// Before the read, never after, as with the parse cache.
		const signature = logSignature(eventsRoot);

		if (
			sortedCache &&
			sortedCache.root === eventsRoot &&
			sortedCache.signature === signature
		) {
			if (unreadable) {
				for (const entry of sortedCache.quarantined) unreadable.push(entry);
			}

			// A copy, so a caller reordering its list cannot reorder the cache.
			lastOrder = sortedCache.sorted;
			return succeeded('All events loaded, unchanged', [...sortedCache.sorted]);
		}

		lastOrder = null;
		if (!fs.existsSync(dir)) {
			return succeeded('No events found', []);
		}

		// A file gone mid-read means a sync renamed it: list again. Quarantine is
		// collected per attempt so it is not reported twice.
		let entries: ReconstructedEvent[] = [];
		let quarantined: UnreadableEvent[] = [];
		let read: Array<{
			file: string;
			entries: ReconstructedEvent[];
			lineage: number | null;
		}> = [];

		for (let attempt = 1; ; attempt++) {
			entries = [];
			quarantined = [];
			read = [];
			let listAgain = false;

			for (const file of listEventFiles(dir)) {
				const seen: ParseLineage = {lineage: null};
				const result = parsePersistedEventsFile(
					path.join(dir, file),
					quarantined,
					seen,
				);

				if (isFail(result)) {
					return failed(result.message);
				}

				if (result.value === null) {
					if (attempt < SCAN_ATTEMPTS) {
						listAgain = true;
						break;
					}
					continue;
				}

				// Pushed, not spread: a spread throws past ~125k arguments.
				for (const entry of result.value) entries.push(entry);
				read.push({file, entries: result.value, lineage: seen.lineage});
			}

			if (!listAgain) break;
		}

		if (unreadable) for (const entry of quarantined) unreadable.push(entry);

		const held = sortedCache?.root === eventsRoot ? sortedCache : null;
		sortedCache = null;

		const files: HeldFiles = new Map(
			read.map(({file, entries, lineage}) => [
				file,
				{lineage, count: entries.length},
			]),
		);

		// Only grown, by events that all land after the held order: append them.
		// A file redone whole or gone is no append, and is sorted again.
		const added = held ? addedSince(held.files, read) : null;
		const appended = held && added ? appendToOrder(held, added) : null;

		let sorted: ReconstructedEvent[];
		if (held && appended) {
			for (const entry of appended.order) {
				held.sorted.push(entry);
				held.ids.set(entry.id[0], held.ids.size);
			}
			held.spine = appended.spine;
			held.signature = signature;
			held.quarantined = quarantined;
			held.files = files;
			sorted = held.sorted;
			if (isSettledSignature(signature)) sortedCache = held;
		} else {
			const fresh = sortEventsIndexed(entries, catalog.genesis);
			sorted = fresh.sorted;
			if (isSettledSignature(signature)) {
				sortedCache = {
					root: eventsRoot,
					signature,
					quarantined,
					files,
					...fresh,
				};
			}
		}

		lastOrder = sorted;

		// The causal order's tail, which is what the next write points at.
		// Recorded here because this is the one place that has just paid for it.
		edgeCache = {
			root: eventsRoot,
			signature,
			edge: sorted.at(-1)?.id?.[0] ?? null,
		};

		return succeeded(
			appended ? 'All events loaded, appended' : 'All events loaded',
			[...sorted],
		);
	}

	// Boot paths use this to lock where history is unreadable; readers wanting
	// only the events use `loadMergedEvents`.
	function loadMergedEventsWithUnreadable(
		stateBranchRoot: string,
	): Result<{events: Event<M>[]; unreadable: UnreadableEvent[]}> {
		const unreadable: UnreadableEvent[] = [];

		const allEvents = loadAllPersistedEvents(stateBranchRoot, unreadable);
		if (isFail(allEvents)) {
			return failed(allEvents.message);
		}

		const order = allEvents.value;
		const held =
			decodedCache &&
			decodedCache.order === lastOrder &&
			order.length >= decodedCache.length
				? decodedCache
				: null;
		const from = held?.length ?? 0;
		const fresh: UnreadableEvent[] = [];
		const decoded = decodeReconstructedEvents(order.slice(from), fresh);
		if (isFail(decoded)) return failed(decoded.message);

		const events = held ? held.events : [];
		const lost = held ? held.unreadable : [];
		for (const event of decoded.value) events.push(event);
		for (const entry of fresh) lost.push(entry);
		decodedCache = lastOrder
			? {order: lastOrder, length: order.length, events, unreadable: lost}
			: null;

		for (const entry of lost) unreadable.push(entry);

		// A copy, so a caller reordering its list cannot reorder the cache.
		return succeeded('Loaded merged events', {events: [...events], unreadable});
	}

	// Actors come off file names, so they survive an undecodable payload.
	function loadEventActors(
		stateBranchRoot: string,
	): Result<{userId: string; userName: string}[]> {
		const allEvents = loadAllPersistedEvents(stateBranchRoot);
		if (isFail(allEvents)) return failed(allEvents.message);

		return succeeded(
			'Loaded event actors',
			allEvents.value.map(({userId, userName}) => ({userId, userName})),
		);
	}

	// Names carried by older `<id>.<name>.jsonl` file names, by author id: the
	// fallback for ids the registry lacks. Reads only the directory listing.
	function loadActorNames(stateBranchRoot: string): Map<string, string> {
		const byId = new Map<string, string>();
		const dir = getEventsDirPath(stateBranchRoot);

		let fileNames: string[];
		try {
			if (!fs.existsSync(dir)) return byId;

			fileNames = fs.readdirSync(dir);
		} catch {
			// A name is a nicety; a log that cannot list its files has a bigger
			// problem, and it is not this function's to report.
			return byId;
		}

		// One id under two older file names; directory order says nothing of which is newer.
		const ambiguous = new Set<string>();

		for (const fileName of fileNames) {
			if (!fileName.endsWith('.jsonl')) continue;

			const actor = parseEventFileActor(fileName);
			if (isFail(actor)) continue;

			const {userId, userName} = actor.value;
			if (!userId || !userName || userName === UNNAMED_ACTOR) continue;

			const seen = byId.get(userId);
			if (seen !== undefined && seen !== userName) ambiguous.add(userId);

			byId.set(userId, userName);
		}

		if (ambiguous.size === 0) return byId;

		// Only for those ids: the log's order says which name came last.
		const actors = loadEventActors(stateBranchRoot);
		if (isFail(actors)) return byId;

		for (const {userId, userName} of actors.value) {
			if (!ambiguous.has(userId)) continue;
			if (!userName || userName === UNNAMED_ACTOR) continue;

			byId.set(userId, userName);
		}

		return byId;
	}

	function loadMergedEvents(stateBranchRoot: string): Result<Event<M>[]> {
		const result = loadMergedEventsWithUnreadable(stateBranchRoot);
		if (isFail(result)) return failed(result.message);

		return succeeded('Loaded merged events', result.value.events);
	}

	function loadMergedEventsBefore(
		stateBranchRoot: string,
		targetTime: number,
	): Result<{
		appliedEvents: Event<M>[];
		unappliedEvents: Event<M>[];
	}> {
		const allEvents = loadAllPersistedEvents(stateBranchRoot);

		if (isFail(allEvents)) {
			return failed(allEvents.message);
		}

		const {appliedEvents, unappliedEvents} = splitEventsAtTime(
			allEvents.value,
			targetTime,
		);

		const decodedAppliedEvents = decodeReconstructedEvents(appliedEvents);
		if (isFail(decodedAppliedEvents)) {
			return failed(decodedAppliedEvents.message);
		}

		const decodedUnappliedEvents = decodeReconstructedEvents(unappliedEvents);
		if (isFail(decodedUnappliedEvents)) {
			return failed(decodedUnappliedEvents.message);
		}

		return succeeded('Loaded merged events before time', {
			appliedEvents: decodedAppliedEvents.value,
			unappliedEvents: decodedUnappliedEvents.value,
		});
	}

	function getEdgeRef(rootDir = process.cwd()): Result<string | null> {
		const signature = logSignature(rootDir);

		if (
			edgeCache &&
			edgeCache.root === rootDir &&
			edgeCache.signature === signature
		) {
			return succeeded('Loaded edge reference, unchanged', edgeCache.edge);
		}

		// Populates the cache on its way through, so a boot pays for this once
		// and the writes after it do not pay at all.
		const persisted = loadAllPersistedEvents(rootDir);
		if (isFail(persisted)) {
			return failed(persisted.message);
		}

		return succeeded(
			'Loaded edge reference',
			persisted.value.at(-1)?.id?.[0] ?? null,
		);
	}

	/**
	 * Advances the cached edge to `id` without rereading; sound only for an id minted
	 * as a child of that edge. Dropped instead if any other file moved.
	 */
	/**
	 * Extends the ordered log by this process's own line, as a load would order
	 * it: its parent is the old tail, so it comes last. Dropped instead if any
	 * other file moved, the line names another parent, or the id is not new.
	 */
	function advanceSortedLog(
		rootDir: string,
		filePath: string,
		line: string,
		bytes: number,
	): void {
		const held = sortedCache;
		if (!held || held.root !== rootDir) return;
		sortedCache = null;

		const next = signatureAfterOwnAppend(
			rootDir,
			held.signature,
			path.basename(filePath),
			bytes,
		);
		if (next === null) return;

		// The parse cache learns the line too, or the next load would read it
		// as new and sort again.
		const extended = extendParse(filePath, line);
		if (!extended) return;

		// The parse it grew from must be the one the order holds, entry for entry.
		const fileName = path.basename(filePath);
		const was = held.files.get(fileName);
		const baseCount = extended.base?.entries.length ?? 0;
		if (
			was
				? was.lineage !== extended.base?.lineage || was.count !== baseCount
				: baseCount !== 0
		) {
			return;
		}
		const {entry} = extended;
		// Last only where the rule for any append says so: new, waited on by
		// nothing held, and under the spine.
		const appended = appendToOrder(held, [entry]);
		if (!appended) return;

		// In place: every read hands out a copy, so nothing else holds this array.
		held.sorted.push(entry);
		held.ids.set(entry.id[0], held.ids.size);
		held.spine = appended.spine;
		held.files.set(fileName, {lineage: extended.lineage, count: baseCount + 1});
		held.signature = next;
		sortedCache = held;
	}

	function advanceEdgeRef(
		rootDir: string,
		fileName: string,
		id: string,
		/** The line's size: the file grown by more holds another process's line. */
		bytes: number,
	): void {
		if (!edgeCache || edgeCache.root !== rootDir) return;

		const next = signatureAfterOwnAppend(
			rootDir,
			edgeCache.signature,
			fileName,
			bytes,
		);

		// Null means someone else's events arrived, and the tail is theirs to
		// decide — so the cache is dropped and the next read derives it.
		edgeCache =
			next === null ? null : {root: rootDir, signature: next, edge: id};
	}

	// For tests, which mock the filesystem; clears the parse cache too.
	function clearEdgeCache(): void {
		edgeCache = null;
		sortedCache = null;
		lastOrder = null;
		decodedCache = null;
		clearParseCache();
	}

	const getSortedEvents = (
		reconstructedEvents: ReconstructedEvent[],
	): ReconstructedEvent[] => sortEvents(reconstructedEvents, catalog.genesis);

	// For callers that pick a cut time from one event (`:peek prev/next`) — the
	// values come from the same full set splitEventsAtTime will judge by.
	function loadEffectiveEventTimes(
		stateBranchRoot: string,
	): Result<Map<string, number | null>> {
		const allEvents = loadAllPersistedEvents(stateBranchRoot);
		if (isFail(allEvents)) return failed(allEvents.message);

		const times = effectiveEventTimes(allEvents.value);

		return succeeded(
			'Loaded effective event times',
			new Map(
				allEvents.value.map((event, index) => [
					event.id[0],
					times[index] ?? null,
				]),
			),
		);
	}

	// The causal order undecoded: entries keep their parent links, which a cut
	// at a time reads. A copy, from the ordered-log cache when unchanged.
	const loadOrderedEntries = (
		stateBranchRoot: string,
	): Result<ReconstructedEvent[]> => loadAllPersistedEvents(stateBranchRoot);

	return {
		fromPersistedEvent,
		decodeReconstructedEvents,
		loadOrderedEntries,
		loadMergedEventsWithUnreadable,
		loadEventActors,
		loadActorNames,
		loadMergedEvents,
		loadMergedEventsBefore,
		getEdgeRef,
		advanceEdgeRef,
		advanceSortedLog,
		clearEdgeCache,
		getSortedEvents,
		loadEffectiveEventTimes,
	};
};

export type Loader<M extends EventMap> = ReturnType<typeof createLoader<M>>;
