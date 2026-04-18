import fs from 'node:fs';
import path from 'node:path';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';
import {PersistedEvent} from './event-persist.js';
import {AppEvent, AppEventMap} from './event.model.js';
import {resolveEpiqRoot} from './event-persist.js'; // or better: move to shared path util

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

export type ReconstructedEvent = PersistedEvent & {
	userId: string;
};

const getEventsDir = (rootDir = process.cwd()) =>
	path.join(resolveEpiqRoot(rootDir), EPIQ_DIR, EVENTS_DIR);

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

export const getPersistedAction = (
	entry: PersistedEvent,
): Result<keyof PersistedPayloadMap> => {
	const keys = Object.keys(entry).filter(key => key !== 'id') as Array<
		keyof PersistedPayloadMap
	>;

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

export const fromPersistedEvent = (
	entry: ReconstructedEvent,
): Result<AppEvent> => {
	const {userId, ...persistedEntry} = entry;

	const actionResult = getPersistedAction(persistedEntry);
	if (isFail(actionResult)) {
		return failed(actionResult.message);
	}

	const action = actionResult.data;
	if (!action) {
		return failed('Action key is undefined');
	}

	const eventId = entry.id?.[0];
	if (!eventId) {
		return failed('Persisted event is missing id');
	}

	const payload = (persistedEntry as Record<string, unknown>)[
		action
	] as PersistedPayloadMap[typeof action];

	return succeeded<AppEvent>('Decoded persisted event', {
		id: eventId,
		action,
		payload,
		userId,
	} as AppEvent);
};

export function loadAllPersistedEvents(
	rootDir = process.cwd(),
): Result<ReconstructedEvent[]> {
	const dir = getEventsDir(rootDir);
	if (!fs.existsSync(dir)) {
		return failed('No events found');
	}

	const files = fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.map(file => path.join(dir, file));

	const entries: ReconstructedEvent[] = [];

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, 'utf8');
		const userId = path.basename(filePath, '.jsonl') || 'unknown';

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				const parsed = JSON.parse(trimmed) as PersistedEvent;
				entries.push({
					...parsed,
					userId,
				});
			} catch {
				return failed(`Failed to parse event from line: ${trimmed}`);
			}
		}
	}

	return succeeded('All events loaded', getSortedEvents(entries));
}

export function loadMergedEvents(rootDir = process.cwd()): Result<AppEvent[]> {
	const allEvents = loadAllPersistedEvents(rootDir);
	if (isFail(allEvents)) {
		return failed(allEvents.message);
	}

	const decoded: AppEvent[] = [];

	for (const entry of allEvents.data) {
		const eventResult = fromPersistedEvent(entry);
		if (isFail(eventResult)) {
			return failed(
				`Failed to decode event ${entry.id?.[0] ?? '<unknown>'}: ${
					eventResult.message
				}`,
			);
		}

		decoded.push(eventResult.data);
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
		persisted.data.at(-1)?.id?.[0] ?? null,
	);
}

export const getSortedEvents = (
	reconstructedEvents: ReconstructedEvent[],
): ReconstructedEvent[] => {
	const byId = new Map(
		reconstructedEvents.map(event => [event.id[0], event] as const),
	);

	const childrenByRef = new Map<string | null, ReconstructedEvent[]>();

	for (const event of reconstructedEvents) {
		const ref = event.id[1];
		const siblings = childrenByRef.get(ref) ?? [];
		siblings.push(event);
		childrenByRef.set(ref, siblings);
	}

	for (const siblings of childrenByRef.values()) {
		siblings.sort((a, b) => {
			const [idA] = a.id;
			const [idB] = b.id;
			return idA.localeCompare(idB);
		});
	}

	const result: ReconstructedEvent[] = [];
	const visited = new Set<string>();

	const visit = (ref: string | null) => {
		const children = childrenByRef.get(ref) ?? [];

		for (const event of children) {
			const [eventId] = event.id;
			if (visited.has(eventId)) continue;

			visited.add(eventId);
			result.push(event);
			visit(eventId);
		}
	};

	visit(null);

	const orphans = [...reconstructedEvents]
		.filter(event => {
			const [eventId] = event.id;
			return !visited.has(eventId);
		})
		.sort((a, b) => {
			const [idA, refA] = a.id;
			const [idB, refB] = b.id;

			const aRefExists = refA === null || byId.has(refA);
			const bRefExists = refB === null || byId.has(refB);

			if (aRefExists && !bRefExists) return -1;
			if (!aRefExists && bRefExists) return 1;

			const refCmp = (refA ?? '').localeCompare(refB ?? '');
			if (refCmp !== 0) return refCmp;

			return idA.localeCompare(idB);
		});

	return [...result, ...orphans];
};
