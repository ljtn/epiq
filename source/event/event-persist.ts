import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {failed, succeeded} from '../lib/command-line/command-types.js';
import {AppEvent, AppEventMap} from './event.model.js';
import {getEdgeRef} from './event-load.js';
import {getSettingsState} from '../lib/state/settings.state.js';

const getNextId = monotonicFactory();

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

type Id = string;
type RefId = string;
export type EventTag = [Id, RefId | null];

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

export type PersistedEvent = {
	id: EventTag;
} & {
	[K in keyof PersistedPayloadMap]: {
		[P in K]: PersistedPayloadMap[P];
	};
}[keyof PersistedPayloadMap];

type PersistSuccess = {
	path: string;
	entry: PersistedEvent;
};

const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';

const resolveActorId = () => {
	const explicit = process.env['EPIQ_ACTOR_ID'];
	if (explicit?.trim()) return sanitizeFilePart(explicit);

	const envUser = getSettingsState().userName;

	if (envUser?.trim()) return sanitizeFilePart(envUser);

	try {
		return sanitizeFilePart(os.userInfo().username);
	} catch {
		return 'unknown';
	}
};

const getEventsDir = (rootDir = process.cwd()) =>
	path.join(rootDir, EPIQ_DIR, EVENTS_DIR);

export const getEventLogPath = (rootDir = process.cwd()) => {
	const actorId = resolveActorId();
	return path.join(getEventsDir(rootDir), `${actorId}.jsonl`);
};

export const toPersistedEvent = (
	event: AppEvent,
	id: EventTag,
): PersistedEvent =>
	({
		[event.action]: event.payload,
		id,
	} as unknown as PersistedEvent);

export function persist(event: AppEvent, rootDir = process.cwd()) {
	try {
		const dir = getEventsDir(rootDir);
		const filePath = getEventLogPath(rootDir);

		fs.mkdirSync(dir, {recursive: true});

		const edgeRef = getEdgeRef(rootDir);

		let newId: string;
		if (edgeRef) {
			const edgeTime = decodeTime(edgeRef);
			const nextTime = Math.max(Date.now(), edgeTime + 1);
			newId = getNextId(nextTime);
		} else {
			newId = getNextId();
		}

		const entry = toPersistedEvent(event, [newId, edgeRef]);

		fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');

		return succeeded<PersistSuccess>('Event persisted', {
			path: filePath,
			entry,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown persist error';

		return failed(`Failed to persist event: ${message}`);
	}
}
