import fs from 'node:fs';
import path from 'node:path';
import {decodeTime} from 'ulid';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {parsePersistedEvent, PersistedEvent} from './event-persist.js';
import {AppEvent, AppEventMap} from './event.model.js';
import {getEventsDirPath} from '../storage/paths.js';

const EventFileNameSchema = z.object({
	userId: z.string().min(1).default('unknown'),
	userName: z.string().min(1).default('unknown'),
});

export type ReconstructedEvent = PersistedEvent & {
	userId: string;
	userName: string;
};

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

const parseEventFileActor = (
	filePath: string,
): Result<{userId: string; userName: string}> => {
	const [userId, userName] = path.basename(filePath, '.jsonl').split('.');

	const result = EventFileNameSchema.safeParse({
		userId,
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
	entry: PersistedEvent,
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
	entry: PersistedEvent,
	action: K,
): entry is PersistedEvent & Record<K, AppEventMap[K]['payload']> =>
	action in entry;

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
		const parsedResult = parsePersistedEvent(raw);
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
	epiqRoot: string,
): Result<ReconstructedEvent[]> {
	const dir = getEventsDirPath(epiqRoot);

	if (!fs.existsSync(dir)) {
		return failed('No events found');
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

export function loadMergedEvents(epiqRoot: string): Result<AppEvent[]> {
	const allEvents = loadAllPersistedEvents(epiqRoot);
	if (isFail(allEvents)) {
		return failed(allEvents.message);
	}

	const decoded: AppEvent[] = [];

	for (const entry of allEvents.value) {
		const eventResult = fromPersistedEvent(entry);
		if (isFail(eventResult)) {
			return failed(
				`Failed to decode event ${entry.id?.[0] ?? '<unknown>'}: ${
					eventResult.message
				}`,
			);
		}

		decoded.push(eventResult.value);
	}

	return succeeded('Loaded merged events', decoded);
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
	if (reconstructedEvents.length === 0) return [];

	const afterMap = new Map<string | null, ReconstructedEvent[]>();

	// Group by insertion anchor (id[1] = "place me right after this event")
	for (const event of reconstructedEvents) {
		const afterRef = event.id[1] ?? null;
		if (!afterMap.has(afterRef)) afterMap.set(afterRef, []);
		afterMap.get(afterRef)!.push(event);
	}

	// Sort siblings at each anchor by ULID (clock-drift safe)
	for (const siblings of afterMap.values()) {
		siblings.sort((a, b) => a.id[0].localeCompare(b.id[0]));
	}

	const result: ReconstructedEvent[] = [];
	const placed = new Set<string>();

	// Roots
	const roots = afterMap.get(null) ?? [];
	place(roots);

	let changed = true;
	while (changed) {
		changed = false;

		for (let i = 0; i < result.length; i++) {
			const anchorId = result[i].id[0];
			const pendingAnchoredEvents = (afterMap.get(anchorId) ?? []).filter(
				e => !placed.has(e.id[0]),
			);

			if (pendingAnchoredEvents.length === 0) continue;

			// Insert right after the anchor
			result.splice(i + 1, 0, ...pendingAnchoredEvents);

			for (const ev of pendingAnchoredEvents) {
				placed.add(ev.id[0]);
			}

			changed = true;
			// Skip inserted events in this pass. Their own anchored events
			// will be processed in the next while iteration.
			i += pendingAnchoredEvents.length;
		}
	}

	// Orphans fallback (should be empty in a healthy log)
	const orphans = reconstructedEvents
		.filter(e => !placed.has(e.id[0]))
		.sort((a, b) => a.id[0].localeCompare(b.id[0]));

	result.push(...orphans);

	return result;

	function place(events: ReconstructedEvent[]) {
		for (const e of events) {
			if (placed.has(e.id[0])) continue;
			result.push(e);
			placed.add(e.id[0]);
		}
	}
};

export const splitEventsAtTime = (
	events: AppEvent[],
	targetTime: number,
): {
	appliedEvents: AppEvent[];
	unappliedEvents: AppEvent[];
} => {
	const cutoffIndex = events.findIndex(event => {
		try {
			return decodeTime(event.id) > targetTime;
		} catch {
			return true;
		}
	});

	if (cutoffIndex === -1) {
		return {
			appliedEvents: events,
			unappliedEvents: [],
		};
	}

	return {
		appliedEvents: events.slice(0, cutoffIndex),
		unappliedEvents: events.slice(cutoffIndex),
	};
};
