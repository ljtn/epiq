import fs from 'node:fs';
import path from 'node:path';
import {decodeTime} from 'ulid';
import {z} from 'zod';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {AppEvent, AppEventMap, isKnownEventAction} from './event.model.js';
import {
	isSupportedSchemaVersion,
	parsePersistedEnvelope,
	PersistedEnvelope,
} from './event-persist.js';

const EventFileNameSchema = z.object({
	userId: z.string().min(1).default('unknown'),
	userName: z.string().min(1).default('unknown'),
});

// `v` is the version as written, not necessarily one we support: ordering and
// ancestry run over these, so an unreadable event keeps its place.
export type ReconstructedEvent = PersistedEnvelope & {
	userId: string;
	userName: string;
};

// Orderable but not interpretable. `targetNodeId` scopes the resulting lock.
export type UnreadableEvent = {
	eventId: string;
	reason: 'unsupported-schema-version' | 'unknown-action';
	detail: string;
	targetNodeId: string | null;
};

// Best-effort, and deliberately unwilling to guess: anything ambiguous returns
// null so the caller falls back to a board-wide lock rather than locking the
// wrong node.
const getTargetNodeId = (entry: ReconstructedEvent): string | null => {
	const payloads = Object.entries(entry).filter(
		([key]) =>
			key !== 'id' && key !== 'v' && key !== 'userId' && key !== 'userName',
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

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

// File names are lowercased on the way to disk, but contributor records keep
// the uppercase `ulid()` id, so a lowercased userId splits one person in two.
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
	const userId =
		separatorIndex === -1 ? baseName : baseName.slice(0, separatorIndex);
	// Undefined, not '', so the schema's 'unknown' default applies rather than
	// tripping its min(1).
	const userName =
		separatorIndex === -1 ? undefined : baseName.slice(separatorIndex + 1);

	const result = EventFileNameSchema.safeParse({
		// Id only: the name segment is compared against a re-encoded (lowercased)
		// registry name, so changing its case would break that match.
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

export const getPersistedAction = (
	entry: object,
): Result<keyof PersistedPayloadMap> => {
	const keys = Object.keys(entry).filter(
		key => key !== 'id' && key !== 'v',
	) as Array<keyof PersistedPayloadMap>;

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

const hasPersistedActionPayload = <K extends keyof AppEventMap>(
	entry: object,
	action: K,
): entry is Record<K, AppEventMap[K]['payload']> => action in entry;

const toAppEvent = <K extends keyof AppEventMap>({
	id,
	action,
	payload,
	userId,
	userName,
}: {
	id: string;
	action: K;
	payload: AppEventMap[K]['payload'];
	userId: string;
	userName: string;
}): AppEvent =>
	({
		id,
		action,
		payload,
		userId,
		userName,
	} as AppEvent);

export const fromPersistedEvent = (
	entry: ReconstructedEvent,
): Result<AppEvent> => {
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

	return succeeded<AppEvent>(
		'Decoded persisted event',
		toAppEvent({
			id: eventId,
			action,
			payload: persistedEntry[action],
			userId,
			userName,
		}),
	);
};

export const decodeReconstructedEvents = (
	events: ReconstructedEvent[],
	unreadable?: UnreadableEvent[],
): Result<AppEvent[]> => {
	const decoded: AppEvent[] = [];
	const skippedActions = new Map<string, number>();
	const skippedVersions = new Map<number, number>();

	for (const entry of events) {
		// Skipped here, after ordering and anchoring, so the event keeps its place
		// in history. Decoding is what would fail on an unknown payload shape.
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

		if (isFail(eventResult)) {
			return failed(
				`Failed to decode event ${entry.id?.[0] ?? '<unknown>'}: ${
					eventResult.message
				}`,
			);
		}

		// Events written by a newer epiq may carry actions this version does
		// not understand. Skip them instead of failing the whole replay — the
		// persisted logs are untouched, so upgrading restores them.
		const action = eventResult.value.action as string;
		if (!isKnownEventAction(action)) {
			skippedActions.set(action, (skippedActions.get(action) ?? 0) + 1);
			unreadable?.push({
				eventId: entry.id[0],
				reason: 'unknown-action',
				detail: action,
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

export const parsePersistedEventsFile = (
	filePath: string,
): Result<ReconstructedEvent[]> => {
	if (!fs.existsSync(filePath)) {
		return succeeded('Event file missing', []);
	}
	const actorResult = parseEventFileActor(filePath);
	if (isFail(actorResult)) return failed(actorResult.message);

	const content = fs.readFileSync(filePath, 'utf8');
	const entries: ReconstructedEvent[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			return failed(`Failed to parse event JSON from ${filePath}: ${trimmed}`);
		}

		// Envelope only: an unreadable version is retained for its place in the
		// chain. A malformed envelope is corruption and still fails the load.
		const parsedResult = parsePersistedEnvelope(raw);
		if (isFail(parsedResult)) {
			return failed(`${parsedResult.message} in ${filePath}: ${trimmed}`);
		}

		entries.push({
			...parsedResult.value,
			userId: actorResult.value.userId,
			userName: actorResult.value.userName,
		});
	}

	return succeeded('Parsed persisted events file', entries);
};

function loadAllPersistedEvents(
	eventsRoot: string,
): Result<ReconstructedEvent[]> {
	const dir = getEventsDirPath(eventsRoot);

	if (!fs.existsSync(dir)) {
		return succeeded('No events found', []);
	}

	const files = fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.map(file => path.join(dir, file));

	const entries: ReconstructedEvent[] = [];

	for (const filePath of files) {
		const result = parsePersistedEventsFile(filePath);

		if (isFail(result)) {
			return failed(result.message);
		}

		entries.push(...result.value);
	}

	return succeeded('All events loaded', getSortedEvents(entries));
}

// What the last full load found. Held here rather than in `AppState` because
// `resetState()` wipes that, and the paths that rebuild live state after a
// checkout have to re-apply the locks on the other side of exactly that reset.
let lastUnreadable: UnreadableEvent[] = [];

export const getLastUnreadableEvents = (): UnreadableEvent[] => lastUnreadable;

// Boot paths use this to lock where history is unreadable; readers wanting
// only the events use `loadMergedEvents`.
export function loadMergedEventsWithUnreadable(
	stateBranchRoot: string,
): Result<{events: AppEvent[]; unreadable: UnreadableEvent[]}> {
	const allEvents = loadAllPersistedEvents(stateBranchRoot);
	if (isFail(allEvents)) {
		return failed(allEvents.message);
	}

	const unreadable: UnreadableEvent[] = [];
	const decoded = decodeReconstructedEvents(allEvents.value, unreadable);
	if (isFail(decoded)) return failed(decoded.message);

	lastUnreadable = unreadable;

	return succeeded('Loaded merged events', {events: decoded.value, unreadable});
}

// Actors come off the file name, so they survive a payload this build cannot
// decode. Guards that ask "has this contributor ever authored anything" have to
// read these rather than the decoded events, or an unreadable version makes
// someone look unauthored.
export function loadEventActors(
	stateBranchRoot: string,
): Result<{userId: string; userName: string}[]> {
	const allEvents = loadAllPersistedEvents(stateBranchRoot);
	if (isFail(allEvents)) return failed(allEvents.message);

	return succeeded(
		'Loaded event actors',
		allEvents.value.map(({userId, userName}) => ({userId, userName})),
	);
}

export function loadMergedEvents(stateBranchRoot: string): Result<AppEvent[]> {
	const result = loadMergedEventsWithUnreadable(stateBranchRoot);
	if (isFail(result)) return failed(result.message);

	return succeeded('Loaded merged events', result.value.events);
}

export function loadMergedEventsBefore(
	stateBranchRoot: string,
	targetTime: number,
): Result<{
	appliedEvents: AppEvent[];
	unappliedEvents: AppEvent[];
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

export function getEdgeRef(rootDir = process.cwd()): Result<string | null> {
	const persisted = loadAllPersistedEvents(rootDir);
	if (isFail(persisted)) {
		return failed(persisted.message);
	}

	return succeeded(
		'Loaded edge reference',
		persisted.value.at(-1)?.id?.[0] ?? null,
	);
}
export const getSortedEvents = (
	reconstructedEvents: ReconstructedEvent[],
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
		children.sort((a, b) => a.id[0].localeCompare(b.id[0]));
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

	const roots = childrenByRef.get(null) ?? [];
	for (const root of roots) {
		visit(root);
	}

	const orphanRoots = reconstructedEvents
		.filter(event => {
			const eventId = event.id[0];
			const refId = event.id[1] ?? null;

			return !placed.has(eventId) && refId !== null && !byEventId.has(refId);
		})
		.sort((a, b) => a.id[0].localeCompare(b.id[0]));

	for (const orphanRoot of orphanRoots) {
		visit(orphanRoot);
	}

	const remaining = reconstructedEvents
		.filter(event => !placed.has(event.id[0]))
		.sort((a, b) => a.id[0].localeCompare(b.id[0]));

	for (const event of remaining) {
		visit(event);
	}

	return result;
};

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

	for (const event of events) {
		const eventId = event.id[0];
		const refId = event.id[1];

		let shouldBeApplied = false;

		try {
			shouldBeApplied = decodeTime(eventId) < targetTime;
		} catch {
			shouldBeApplied = false;
		}

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
