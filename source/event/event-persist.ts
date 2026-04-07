import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {failed, succeeded} from '../lib/command-line/command-types.js';
import {AppEvent} from './event.model.js';
import {getEdgeRef} from './event-load.js';

const getNextId = monotonicFactory();

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

type Id = string;
type RefId = string;
type EventTag = [Id, RefId | null];

export type PersistedEvent = {
	id: EventTag;
	usr: string;
	do: AppEvent['action'];
	data: AppEvent['payload'];
};

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

	const envUser =
		process.env['GIT_AUTHOR_NAME'] ||
		process.env['GIT_COMMITTER_NAME'] ||
		process.env['USER'] ||
		process.env['USERNAME'];

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

export function persist(event: AppEvent, rootDir = process.cwd()) {
	try {
		const actorId = resolveActorId();
		const dir = getEventsDir(rootDir);
		const filePath = getEventLogPath(rootDir);

		fs.mkdirSync(dir, {recursive: true});

		const edgeRef = getEdgeRef();
		let newId: string;
		if (edgeRef) {
			const edgeTime = decodeTime(edgeRef);
			const offset = Math.abs(Date.now() - edgeTime);
			const newEdgeTime = edgeTime + offset + 1;
			newId = getNextId(newEdgeTime);
		} else {
			newId = getNextId();
		}

		const entry: PersistedEvent = {
			id: [newId, edgeRef],
			usr: actorId,
			do: event.action,
			data: event.payload,
		};

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
