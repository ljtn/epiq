import fs from 'node:fs';
import path from 'node:path';
import {decodeTime} from 'ulid';
import {z} from 'zod';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {toEffectiveUlidTimes} from './date-utils.js';
import {EventCatalog} from './event-catalog.js';
import {
	isSupportedSchemaVersion,
	parsePersistedEnvelope,
	PersistedEnvelope,
} from './event-envelope.js';
import {ActionOf, Actor, Event, EventMap} from './event.model.js';
import {
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

export const getPersistedAction = (entry: object): Result<string> => {
	const keys = Object.keys(entry).filter(key => key !== 'id' && key !== 'v');

	if (keys.length !== 1) {
		return failed(
			`Invalid persisted event: expected exactly 1 action key, got ${keys.length}`,
		);
	}

	if (!keys[0] || !(keys[0] in entry)) {
		return failed('Invalid persisted event: action key is missing or invalid');
	}
	return succeeded('Resolved persisted action', keys[0]);
};

const hasPersistedActionPayload = (
	entry: object,
	action: string,
): entry is Record<string, unknown> => action in entry;

// Parsed files, keyed by a stat stamp taken BEFORE the read, so a write landing
// in between is reparsed next time rather than cached as seen.
const parseCache = new Map<
	string,
	{stamp: string; entries: ReconstructedEvent[]; quarantined: UnreadableEvent[]}
>();

// Caps on lines (events and quarantined lines alike) and on entries.
const PARSE_CACHE_MAX_LINES = 300_000;
const PARSE_CACHE_MAX_FILES = 512;

let parseCacheLines = 0;

const linesOf = (entry: {
	entries: ReconstructedEvent[];
	quarantined: UnreadableEvent[];
}): number => entry.entries.length + entry.quarantined.length;

const rememberParse = (
	filePath: string,
	stamp: string,
	entries: ReconstructedEvent[],
	quarantined: UnreadableEvent[],
): void => {
	const previous = parseCache.get(filePath);
	if (previous) parseCacheLines -= linesOf(previous);

	const next = {stamp, entries, quarantined};

	// Deleted first, so a re-remembered file moves to the back of the eviction order.
	parseCache.delete(filePath);
	parseCache.set(filePath, next);
	parseCacheLines += linesOf(next);

	for (const [key, value] of parseCache) {
		if (
			parseCacheLines <= PARSE_CACHE_MAX_LINES &&
			parseCache.size <= PARSE_CACHE_MAX_FILES
		) {
			break;
		}
		if (key === filePath) continue;

		parseCache.delete(key);
		parseCacheLines -= linesOf(value);
	}
};

/** The tests drive the log through mocks, where a stamp says nothing. */
export const clearParseCache = (): void => {
	parseCache.clear();
	parseCacheLines = 0;
};

// A file written within a clock tick of the read is not cached: two same-length
// writes in one tick share a stamp (Linux mtime is millisecond-grained).
const RACY_WRITE_WINDOW_MS = 2n;

const MS_IN_NS = 1_000_000n;

type FileStamp = {value: string; settled: boolean};

const fileStamp = (filePath: string): FileStamp | null => {
	try {
		const {size, mtimeNs} = fs.statSync(filePath, {bigint: true});

		return {
			value: `${size}:${mtimeNs}`,
			settled:
				BigInt(Date.now()) * MS_IN_NS - mtimeNs >
				RACY_WRITE_WINDOW_MS * MS_IN_NS,
		};
	} catch {
		return null;
	}
};

/** Null when the file is not there — listed a moment ago, perhaps, and gone now. */
export const parsePersistedEventsFile = (
	filePath: string,
	unreadable?: UnreadableEvent[],
): Result<ReconstructedEvent[] | null> => {
	const actorResult = parseEventFileActor(filePath);
	if (isFail(actorResult)) return failed(actorResult.message);

	const stamp = fileStamp(filePath);
	const remembered = stamp ? parseCache.get(filePath) : undefined;

	if (stamp && remembered && remembered.stamp === stamp.value) {
		// Appended one at a time rather than spread: a log can hold more lines
		// than an argument list has room for, and a corrupt one holds them here.
		if (unreadable)
			for (const entry of remembered.quarantined) {
				unreadable.push(entry);
			}

		// A copy of the list, so a caller sorting it cannot reorder the cache.
		return succeeded('Parsed persisted events file', [...remembered.entries]);
	}

	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		if (isVanished(error)) return succeeded('Event file missing', null);
		throw error;
	}

	const entries: ReconstructedEvent[] = [];
	const fileName = path.basename(filePath);
	// Collected separately from the caller's list so the entry can be remembered
	// with the events it belongs to, and replayed on a hit.
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

	for (const [index, line] of content.split('\n').entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			quarantine(index + 1, 'invalid JSON');
			continue;
		}

		// Envelope only: an unreadable version is retained for its place in the
		// chain.
		const parsedResult = parsePersistedEnvelope(raw);
		if (isFail(parsedResult)) {
			quarantine(index + 1, parsedResult.message);
			continue;
		}

		entries.push({
			...parsedResult.value,
			userId: actorResult.value.userId,
			userName: actorResult.value.userName,
		});
	}

	if (unreadable) for (const entry of quarantined) unreadable.push(entry);

	// Cached only with a readable, settled stamp.
	if (stamp?.settled) {
		rememberParse(filePath, stamp.value, entries, quarantined);
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
): ReconstructedEvent[] => {
	const byEventId = new Map<string, ReconstructedEvent>();
	const childrenByRef = new Map<string | null, ReconstructedEvent[]>();

	for (const event of reconstructedEvents) {
		const eventId = event.id[0];
		const refId = event.id[1] ?? null;

		byEventId.set(eventId, event);

		const children = childrenByRef.get(refId) ?? [];
		children.push(event);
		childrenByRef.set(refId, children);
	}

	for (const children of childrenByRef.values()) {
		children.sort(compareEvents);
	}

	const result: ReconstructedEvent[] = [];
	const placed = new Set<string>();

	// An explicit stack: the forest is one chain as long as the log.
	const visit = (root: ReconstructedEvent) => {
		const stack: ReconstructedEvent[] = [root];

		while (stack.length > 0) {
			const event = stack.pop() as ReconstructedEvent;
			const eventId = event.id[0];

			if (placed.has(eventId)) continue;

			result.push(event);
			placed.add(eventId);

			// Reversed, so the lowest-ULID sibling is popped first.
			const children = childrenByRef.get(eventId) ?? [];
			for (let index = children.length - 1; index >= 0; index--) {
				stack.push(children[index] as ReconstructedEvent);
			}
		}
	};

	// Only genesis may be a root; any other `refId: null` event is anchored after
	// history with the orphans. Exactly one action key.
	const roots = (childrenByRef.get(null) ?? []).filter(event => {
		const keys = Object.keys(event).filter(key => !ENVELOPE_KEYS.has(key));
		return keys.length === 1 && keys[0] === genesis;
	});
	for (const root of roots) {
		visit(root);
	}

	const orphanRoots = reconstructedEvents
		.filter(event => {
			const eventId = event.id[0];
			const refId = event.id[1] ?? null;

			if (placed.has(eventId)) return false;

			return refId === null || !byEventId.has(refId);
		})
		.sort(compareEvents);

	for (const orphanRoot of orphanRoots) {
		visit(orphanRoot);
	}

	const remaining = reconstructedEvents
		.filter(event => !placed.has(event.id[0]))
		.sort(compareEvents);

	for (const event of remaining) {
		visit(event);
	}

	return result;
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

export const splitEventsAtTime = (
	events: ReconstructedEvent[],
	targetTime: number,
): {
	appliedEvents: ReconstructedEvent[];
	unappliedEvents: ReconstructedEvent[];
} => {
	const unappliedIds = new Set<string>();
	const appliedEvents: ReconstructedEvent[] = [];
	const unappliedEvents: ReconstructedEvent[] = [];

	const times = effectiveEventTimes(events);

	for (let index = 0; index < events.length; index++) {
		const event = events[index]!;
		const eventId = event.id[0];
		const refId = event.id[1];

		const time = times[index] ?? null;
		const shouldBeApplied = time !== null && time < targetTime;

		if (!shouldBeApplied || (refId && unappliedIds.has(refId))) {
			unappliedIds.add(eventId);
			unappliedEvents.push(event);
		} else {
			appliedEvents.push(event);
		}
	}

	return {
		appliedEvents,
		unappliedEvents,
	};
};

/** Reads the log for one catalog: its actions, payload checks and genesis. */
export const createLoader = <M extends EventMap>(catalog: EventCatalog<M>) => {
	const knownActions: ReadonlySet<string> = new Set(catalog.actions);

	const isKnownAction = (action: string): action is ActionOf<M> =>
		knownActions.has(action);

	const fromPersistedEvent = (entry: ReconstructedEvent): Result<Event<M>> => {
		const {userId, userName, ...persistedEntry} = entry;

		const actionResult = getPersistedAction(persistedEntry);
		if (isFail(actionResult)) {
			return failed(actionResult.message);
		}

		const action = actionResult.value;
		const eventId = entry.id?.[0];
		if (!eventId) {
			return failed('Persisted event is missing id');
		}

		if (!hasPersistedActionPayload(persistedEntry, action)) {
			return failed(`Persisted event is missing payload for action: ${action}`);
		}

		// `userName` is dropped, so a replayed event equals the one applied in place.
		return succeeded('Decoded persisted event', {
			id: eventId,
			action,
			payload: persistedEntry[action],
			userId,
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

			decoded.push(eventResult.value);
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

	function loadAllPersistedEvents(
		eventsRoot: string,
		unreadable?: UnreadableEvent[],
	): Result<ReconstructedEvent[]> {
		const dir = getEventsDirPath(eventsRoot);

		// Before the read, never after, as with the parse cache.
		const signature = logSignature(eventsRoot);

		if (!fs.existsSync(dir)) {
			return succeeded('No events found', []);
		}

		// A file gone mid-read means a sync renamed it: list again. Quarantine is
		// collected per attempt so it is not reported twice.
		let entries: ReconstructedEvent[] = [];
		let quarantined: UnreadableEvent[] = [];

		for (let attempt = 1; ; attempt++) {
			entries = [];
			quarantined = [];
			let listAgain = false;

			for (const file of listEventFiles(dir)) {
				const result = parsePersistedEventsFile(
					path.join(dir, file),
					quarantined,
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
			}

			if (!listAgain) break;
		}

		if (unreadable) for (const entry of quarantined) unreadable.push(entry);

		const sorted = sortEvents(entries, catalog.genesis);

		// The causal order's tail, which is what the next write points at.
		// Recorded here because this is the one place that has just paid for it.
		edgeCache = {
			root: eventsRoot,
			signature,
			edge: sorted.at(-1)?.id?.[0] ?? null,
		};

		return succeeded('All events loaded', sorted);
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

		const decoded = decodeReconstructedEvents(allEvents.value, unreadable);
		if (isFail(decoded)) return failed(decoded.message);

		return succeeded('Loaded merged events', {
			events: decoded.value,
			unreadable,
		});
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
	 * Advances the cached edge to this actor's new `id` without rereading the log.
	 * Dropped instead if any other file moved: the tail is then theirs to decide.
	 */
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

	return {
		fromPersistedEvent,
		decodeReconstructedEvents,
		loadMergedEventsWithUnreadable,
		loadEventActors,
		loadActorNames,
		loadMergedEvents,
		loadMergedEventsBefore,
		getEdgeRef,
		advanceEdgeRef,
		clearEdgeCache,
		getSortedEvents,
		loadEffectiveEventTimes,
	};
};

export type Loader<M extends EventMap> = ReturnType<typeof createLoader<M>>;
