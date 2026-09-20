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

// What a log file name yields where it carries no name segment, which is every
// log written since the name left it. Named so the checks below read as
// "nobody chose this" rather than as a comparison against a bare string.
const UNNAMED_ACTOR = 'unknown';

const EventFileNameSchema = z.object({
	userId: z.string().min(1).default(UNNAMED_ACTOR),
	userName: z.string().min(1).default(UNNAMED_ACTOR),
});

// `v` is the version as written, not necessarily one we support: ordering and
// ancestry run over these, so an unreadable event keeps its place.
// Carries the file name's own `userName` beside the actor: the name is not
// part of an event, but it is part of the older file names, and this is what
// `loadActorNames` reads it from before `fromPersistedEvent` drops it.
export type ReconstructedEvent = PersistedEnvelope & Actor & {userName: string};

// Orderable but not interpretable — except `corrupt-line`, which has no
// envelope to order by and is reported only so the gap is visible.
// `targetNodeId` scopes the resulting lock.
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

// Best-effort, and deliberately unwilling to guess: anything ambiguous returns
// null so the caller falls back to a log-wide lock rather than locking the
// wrong node.
const getTargetNodeId = (entry: ReconstructedEvent): string | null => {
	const payloads = Object.entries(entry).filter(
		([key]) => !ENVELOPE_KEYS.has(key),
	);

	// The one-payload-key invariant `getPersistedAction` enforces is never
	// checked on this path, so more than one key means we cannot tell which is
	// the action.
	if (payloads.length !== 1) return null;

	const value = payloads[0]?.[1];
	if (typeof value !== 'object' || value === null) return null;

	const candidate = (value as {id?: unknown}).id;

	return typeof candidate === 'string' && candidate.length > 0
		? candidate
		: null;
};

// File names are lowercased on the way to disk, but an id is minted by `ulid()`
// in upper case, so reading a lowercased one back splits one actor in two.
// Restoring the canonical casing is lossless for ULIDs; anything else is left
// alone rather than guessed at.
const ULID_SHAPE = /^[0-9a-hjkmnp-tv-z]{26}$/i;

const canonicalUserId = (userId: string): string =>
	ULID_SHAPE.test(userId) ? userId.toUpperCase() : userId;

const parseEventFileActor = (
	filePath: string,
): Result<{userId: string; userName: string}> => {
	const baseName = path.basename(filePath, '.jsonl');

	// Split on the FIRST '.' only. '.' survives sanitizing, so a user name may
	// contain any number of them ("J. Lampa" -> `<id>.j.-lampa`), while the id
	// segment never can.
	const separatorIndex = baseName.indexOf('.');
	// The pending log's marker rides on the id segment, so it comes off here —
	// the actor is the same one either way, and a line is not attributed
	// differently for having been written while a sync held the worktree.
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

// What one log file parsed to, while it is still that file.
//
// A read of the log parses every line of every file, and most reads happen
// over a log that has not moved: a scrub asks for a cut every 120 ms, and each
// one re-read and re-parsed the lot — 88 ms at thirty thousand events, again
// and again for an answer that could not have changed.
//
// The stamp is taken BEFORE the read, never after. Taken after, a line landing
// in the gap would be remembered under a stamp that already accounts for it,
// and the stale parse would be served forever. Taken before, a write in the
// gap means the entry is remembered under the older stamp and simply missed
// next time — the same rule, and for the same reason, as `logSignature`.
const parseCache = new Map<
	string,
	{stamp: string; entries: ReconstructedEvent[]; quarantined: UnreadableEvent[]}
>();

// A board's worth, so the cache holds the log it is being asked about and not
// a history of every log this process has seen. Both counted, because both are
// what a log can be made of: a log of nothing but corrupt lines produces no
// events and a quarantine entry per line, and counting only the events would
// let it sit here for free. A cap on entries as well, or ten thousand one-line
// logs stay under any total and never leave.
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

	// Deleted first, so a re-remembered file goes to the back of the insertion
	// order rather than keeping the place it took when it was new. Otherwise the
	// log this process writes to — the one re-parsed most — would be the first
	// evicted.
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

// How recently written a file may be and still be worth remembering.
//
// A stamp can only distinguish two writes the clock could tell apart, and the
// clock is coarse: Linux gives mtime at exactly millisecond granularity, so
// `mtimeNs` there carries no more than `mtimeMs` does. Two same-length writes
// inside one tick therefore share a stamp, and a parse remembered under it
// would be served for the wrong content. Git has the same problem with its
// index and calls such a file racily clean.
//
// So a file whose mtime is within a tick of the read is not remembered at all;
// the next read parses it again, by which time it has settled. It costs
// nothing that matters — a file written this instant is the one about to be
// written again — and it is what makes the stamp a fact rather than a guess.
//
// `mtimeNs` rather than `mtimeMs` all the same: where the filesystem does keep
// sub-millisecond times, as APFS does, it narrows the window this guard has to
// cover.
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

		// A copy of the list, not of the events: the caller concatenates and
		// sorts, and nothing reads an event by mutating it — but a caller that
		// sorted the array it was handed would reorder the cache with it.
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

	// A line whose envelope will not parse carries no id, so unlike an
	// unreadable payload it cannot keep its place in the chain. Skipping it
	// loses that one event; failing the load loses the whole state, for
	// everyone, permanently — `merge=union` splices a half-written line into
	// every clone that pulls, and the log is append-only.
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

	// Only a file whose stamp was readable and has settled: without a stamp
	// there is nothing to say the entry is still that file's, and within a tick
	// of the write there is nothing to say the next write will look different.
	// A cache that cannot be invalidated is worse than none.
	if (stamp?.settled) {
		rememberParse(filePath, stamp.value, entries, quarantined);
	}

	return succeeded('Parsed persisted events file', [...entries]);
};

// Code units, not `localeCompare`: collation follows the process locale, so
// the same ids could order differently on two machines. The relational
// operators compare UTF-16 code units, which every runtime does the same way.
const byCodeUnit = (a: string, b: string): number =>
	a < b ? -1 : a > b ? 1 : 0;

/**
 * Total, so the order is a function of the event *set* alone.
 *
 * Two events can legitimately share a parent, and — through a reused id, or a
 * line that reached two logs — they can share an id too. Comparing ids alone
 * left equal ones tied, and a tie is settled by `readdirSync` order, so two
 * machines holding the same events derived different states. Falling through
 * to the content breaks every tie the same way everywhere: the actor comes off
 * the file name and the payload off the line, both identical on every replica.
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

	// Depth-first, but on an explicit stack: every event refs its predecessor,
	// so the forest is one chain as long as the log and recursion would blow
	// the call stack a few thousand events in.
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

	// Only genesis is a legal root. Any other `refId: null` event — trivially
	// forgeable, and able to sort in front of all of history via a low ULID —
	// is anchored after the known history, with the orphans. Exactly one action
	// key, or extra keys smuggle a payload past a bare `in` check.
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
// where poisoned. One computation over the full reconstructed set, so every
// consumer of a cut agrees on where a poisoned id falls.
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

/**
 * Reads the log for one catalog: which actions it knows, how a payload is
 * checked, and which action is genesis are the only things that differ
 * between products.
 */
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

		// The id and not the name: `userName` is the file name's, kept on the
		// reconstructed entry for `loadActorNames` and destructured off here, so
		// a replayed event is identical to the one the write applied in place —
		// which is what makes skipping the reload after a write sound.
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
			// Skipped here, after ordering and anchoring, so the event keeps its
			// place in history. Decoding is what would fail on an unknown payload
			// shape.
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

			// Quarantined, not fatal: `merge=union` splices any line a peer pushes
			// into every clone, so a malformed payload that failed the load would
			// brick the state for everyone, permanently. The envelope parsed, so
			// the event keeps its place in the chain.
			if (isFail(eventResult)) {
				unreadable?.push({
					eventId: entry.id[0],
					reason: 'invalid-payload',
					detail: eventResult.message,
					targetNodeId: getTargetNodeId(entry),
				});
				continue;
			}

			// Events written by a newer build may carry actions this version does
			// not understand. Skip them instead of failing the whole replay — the
			// persisted logs are untouched, so upgrading restores them.
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

			// The action is one we know, so the payload is one we are about to
			// dereference. Quarantined like any other unreadable line rather than
			// handed to a materializer that assumes a well-behaved writer produced
			// it — the same reasoning as the envelope check above, one layer in.
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

	// The tail of the causal order, which every write has to point at.
	//
	// Held rather than re-derived. Reading it meant reading every line the log
	// has ever held and rebuilding the whole forest, to take one id off the
	// end: at two hundred thousand events that was four seconds for a single
	// write. `EdgeCursor` already avoids it within a batch, for the same
	// reason; a lone write had nothing to belong to.
	let edgeCache: {root: string; signature: string; edge: string | null} | null =
		null;

	function loadAllPersistedEvents(
		eventsRoot: string,
		unreadable?: UnreadableEvent[],
	): Result<ReconstructedEvent[]> {
		const dir = getEventsDirPath(eventsRoot);

		// Before the read, never after: a line landing in the gap would otherwise
		// be remembered under a signature that already accounts for it, and the
		// edge would stay wrong until something else moved.
		const signature = logSignature(eventsRoot);

		if (!fs.existsSync(dir)) {
			return succeeded('No events found', []);
		}

		// A file gone between the listing and its read is one a sync just renamed
		// or git just rewrote; the listing is taken again so the read sees the
		// directory as it is, not as it was. Quarantined lines are collected per
		// attempt, or a listing that had to be repeated would report them twice.
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

				// Appended rather than spread. An argument list has room for about
				// 125,000 entries on this runtime and then throws — out of a
				// function whose whole contract is to return its failures, and on
				// exactly the log large enough for any of this to matter.
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

	// Actors come off the file name, so they survive a payload this build cannot
	// decode. A guard that asks "has this id ever authored anything" has to read
	// these rather than the decoded events, or an unreadable version makes
	// someone look unauthored.
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

	// The names the log file names carry, by author id. A log written before the
	// name left the file name is `<id>.<name>.jsonl` and yields one; a log
	// written since is `<id>.jsonl` and yields nothing, since UNNAMED_ACTOR is
	// nobody's chosen name.
	//
	// Whatever registry the product keeps is the source of record; this is the
	// fallback for an id it has never heard of. Matching and listing take it,
	// because a name that fails to match there mints a duplicate id for somebody
	// who already has one.
	//
	// Reads the directory listing and nothing else. The names are *in* the file
	// names, so parsing a single line would be waste — on a log of a few hundred
	// thousand events that is the difference between a listing and a full parse
	// of every file, on a path a user action sits behind.
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

		// An id named by two different files: before the rename a new name
		// started a new log, so one person can be `<id>.alice.jsonl` and
		// `<id>.alice-cooper.jsonl` at once. Directory order says nothing about
		// which is newer.
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

		// Only those ids, and only now: the log's own order is what says which
		// name came last, and paying for a full parse to settle a rare legacy tie
		// beats showing whichever name the filesystem happened to list second.
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
	 * Moves the edge on after this actor wrote `id` to `fileName`, without
	 * reading the log to confirm it.
	 *
	 * Safe only because of what the id is: a child of the edge it was minted
	 * against, and the deepest node in the forest, so the walk that derives the
	 * order ends on it.
	 *
	 * Any other file moving means someone else's events arrived, and the tail
	 * is then theirs to decide — so the cache is dropped rather than advanced,
	 * and the next read derives it properly. That is the case this has to get
	 * right; a log with one writer would not need the check at all.
	 */
	function advanceEdgeRef(rootDir: string, fileName: string, id: string): void {
		if (!edgeCache || edgeCache.root !== rootDir) return;

		const next = signatureAfterOwnAppend(
			rootDir,
			edgeCache.signature,
			fileName,
		);

		// Null means someone else's events arrived, and the tail is theirs to
		// decide — so the cache is dropped and the next read derives it.
		edgeCache =
			next === null ? null : {root: rootDir, signature: next, edge: id};
	}

	// The tests drive the log through mocks, so they need the edge gone between
	// cases; a signature is no help where the files never existed. The parsed
	// files go with it, for the same reason and in the same breath — a mocked
	// `statSync` is as unreliable a stamp as a mocked `readdirSync` is a
	// signature, and a caller clearing one and not the other would be surprised.
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
