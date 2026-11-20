import fs from 'node:fs';
import path from 'node:path';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {decodeTime, toEffectiveUlidTimes} from './date-utils.js';
import {EventCatalog} from './event-catalog.js';
import {isSupportedSchemaVersion} from './event-envelope.js';
import {ActionOf, Event, EventMap} from './event.model.js';
import {
	isSettledSignature,
	listEventFiles,
	logSignature,
	SCAN_ATTEMPTS,
	signatureAfterOwnAppend,
} from './log-signature.js';
import {appendToOrder, sortEvents, sortEventsIndexed} from './event-order.js';
import {
	clearParseCache,
	deepFreeze,
	ENVELOPE_KEYS,
	UNNAMED_ACTOR,
	extendParse,
	FREEZE_EVENTS,
	keepParsesOf,
	parseEventFileActor,
	parsePersistedEventsFile,
	type ParseLineage,
	type ReconstructedEvent,
	type UnreadableEvent,
} from './event-parse.js';

export {
	clearParseCache,
	parsePersistedEventsFile,
	type ReconstructedEvent,
	type UnreadableEvent,
} from './event-parse.js';
export {
	appendToOrder,
	sortEvents,
	sortEventsIndexed,
	type OrderIndex,
} from './event-order.js';

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
		keepParsesOf(new Set(read.map(({file}) => path.join(dir, file))));

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

/** What a tail of the log is made from: see `log-tail`. */

export type Loader<M extends EventMap> = ReturnType<typeof createLoader<M>>;
