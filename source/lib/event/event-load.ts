import fs from 'node:fs';
import path from 'node:path';
import {decodeTime} from 'ulid';
import {z} from 'zod';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {AppEvent, AppEventMap, isKnownEventAction} from './event.model.js';
import {parsePersistedEvent, PersistedEvent} from './event-persist.js';

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

export const decodeReconstructedEvents = (
	events: ReconstructedEvent[],
): Result<AppEvent[]> => {
	const decoded: AppEvent[] = [];
	const skippedActions = new Map<string, number>();

	for (const entry of events) {
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

export function loadMergedEvents(stateBranchRoot: string): Result<AppEvent[]> {
	const allEvents = loadAllPersistedEvents(stateBranchRoot);
	if (isFail(allEvents)) {
		return failed(allEvents.message);
	}

	return decodeReconstructedEvents(allEvents.value);
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

	const visit = (event: ReconstructedEvent) => {
		const eventId = event.id[0];

		if (placed.has(eventId)) return;

		result.push(event);
		placed.add(eventId);

		const children = childrenByRef.get(eventId) ?? [];
		for (const child of children) {
			visit(child);
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
