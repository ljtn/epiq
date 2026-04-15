import fs from 'node:fs';
import path from 'node:path';
import {
	failed,
	isFail,
	isSuccess,
	succeeded,
} from '../lib/command-line/command-types.js';
import {PersistedEvent, resolveActorId} from './event-persist.js';
import {AppEvent, AppEventMap} from './event.model.js';
import {ulid} from 'ulid';

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

const getEventsDir = (rootDir = process.cwd()) =>
	path.join(rootDir, EPIQ_DIR, EVENTS_DIR);

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

export const getPersistedAction = (entry: PersistedEvent) => {
	const keys = Object.keys(entry).filter(key => key !== 'id') as Array<
		keyof PersistedPayloadMap
	>;

	if (keys.length !== 1) {
		return failed(
			`Invalid persisted event: expected exactly 1 action key, got ${keys.length}`,
		);
	}

	return succeeded('Resolved persisted action', keys[0]);
};

export const fromPersistedEvent = (entry: PersistedEvent) => {
	const actionResult = getPersistedAction(entry);
	if (isFail(actionResult)) return failed(actionResult.message);

	const action = actionResult.data;
	if (!action) {
		return failed('Action key is undefined');
	}
	const payload = (entry as Record<string, unknown>)[
		action
	] as PersistedPayloadMap[typeof action];

	return succeeded<AppEvent>('Decoded persisted event', {
		id: entry.id[0] ?? ulid(),
		action,
		payload,
		userId: resolveActorId(),
	} as AppEvent);
};

export function loadAllPersistedEvents(
	rootDir = process.cwd(),
): PersistedEvent[] {
	const dir = getEventsDir(rootDir);
	if (!fs.existsSync(dir)) return [];

	const files = fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.map(file => path.join(dir, file));

	const entries: PersistedEvent[] = [];

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, 'utf8');

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				entries.push(JSON.parse(trimmed) as PersistedEvent);
			} catch {
				// ignore malformed line
			}
		}
	}

	return getSortedEvents(entries);
}

export function loadMergedEvents(rootDir = process.cwd()): AppEvent[] {
	return loadAllPersistedEvents(rootDir)
		.map(fromPersistedEvent)
		.filter(isSuccess)
		.map(({data}) => data);
}

export function getEdgeRef(rootDir = process.cwd()): string | null {
	const persisted = loadAllPersistedEvents(rootDir);
	return persisted.at(-1)?.id[0] ?? null;
}

export const getSortedEvents = (events: PersistedEvent[]): PersistedEvent[] => {
	const byId = new Map(events.map(event => [event.id[0], event] as const));
	const childrenByRef = new Map<string | null, PersistedEvent[]>();

	for (const event of events) {
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

	const result: PersistedEvent[] = [];
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

	const orphans = [...events]
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
