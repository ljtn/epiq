import fs from 'node:fs';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {getEpiqDirName} from '../init.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';
import {getSettingsState} from '../lib/state/settings.state.js';
import {getEdgeRef} from './event-load.js';
import {
	AppEvent,
	AppEventMap,
	StoredAppEvent,
	stripActor,
	UserId,
} from './event.model.js';

// ======================
// Increment this if we make any non-backwards-compatible changes to the event schema, so we can handle old vs new formats in event loading.
// ======================
const SCHEMA_VERSION = 1;
// ======================

const getNextId = monotonicFactory();

const EVENTS_DIR = 'events';

type Id = string;
type RefId = string;
export type EventTag = [Id, RefId | null];

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

export type PersistedEvent = {
	v: 1;
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

export const resolveActorId = (): Result<UserId> => {
	const {userName, userId} = getSettingsState();
	if (!userName) return failed('User name not configured');
	if (!userId) return failed('User ID not configured');

	const fileName: UserId = `${sanitizeFilePart(userId)}.${sanitizeFilePart(
		userName,
	)}`;
	if (userName.trim()) {
		return succeeded('Successfully resolved actor ID', fileName);
	}
	return failed('Unable to resolve actor ID from settings or OS user info');
};

const hasEpiqDir = (dir: string) => {
	return (
		fs.existsSync(path.join(dir, getEpiqDirName())) &&
		fs.statSync(path.join(dir, getEpiqDirName())).isDirectory()
	);
};

export const resolveEpiqRoot = (startDir = process.cwd()): string => {
	let currentDir = path.resolve(startDir);

	while (true) {
		if (hasEpiqDir(currentDir)) return currentDir;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			// Reached filesystem root, no existing .epiq found.
			// Fall back to the original start directory so init/setup can create one there.
			return path.resolve(startDir);
		}

		currentDir = parentDir;
	}
};

const getEventsDir = (rootDir = process.cwd()) => {
	return path.join(resolveEpiqRoot(rootDir), getEpiqDirName(), EVENTS_DIR);
};

export const getPersistFileName = () => {
	const actorIdResult = resolveActorId();
	if (isFail(actorIdResult) || !actorIdResult.data) {
		return failed('Unable to resolve event log path');
	}
	return succeeded('Succeeded', `${actorIdResult.data}.jsonl`);
};

export const getEventLogPath = (rootDir = process.cwd()): Result<string> => {
	const fileNameResult = getPersistFileName();
	if (isFail(fileNameResult)) {
		return failed('Unable to resolve file name');
	}

	const fileName = fileNameResult.data;

	const isValid = /^(?!.*\.jsonl.*\.jsonl).*\.jsonl$/.test(fileName);

	if (!isValid) {
		return failed(`Invalid event log file name: ${fileName}`);
	}

	return succeeded(
		'Successfully resolved event log path',
		path.join(getEventsDir(rootDir), fileName),
	);
};

export const toPersistedEvent = (
	event: StoredAppEvent,
	id: EventTag,
): PersistedEvent =>
	({
		[event.action]: event.payload,
		v: SCHEMA_VERSION,
		id,
	} as unknown as PersistedEvent);

export function persist(event: AppEvent, rootDir = process.cwd()) {
	try {
		const resolvedRoot = resolveEpiqRoot(rootDir);
		const dir = getEventsDir(resolvedRoot);
		const filePath = getEventLogPath(resolvedRoot);
		if (isFail(filePath)) return filePath;

		fs.mkdirSync(dir, {recursive: true});

		const edgeRef = getEdgeRef(resolvedRoot);
		if (isFail(edgeRef)) return failed(edgeRef.message);

		let newId: string;
		if (edgeRef.data) {
			const edgeTime = decodeTime(edgeRef.data);
			const nextTime = Math.max(Date.now(), edgeTime + 1);
			newId = getNextId(nextTime);
		} else {
			newId = getNextId();
		}

		const entry = toPersistedEvent(stripActor(event), [newId, edgeRef.data]);

		fs.appendFileSync(filePath.data, `${JSON.stringify(entry)}\n`, 'utf8');

		return succeeded<PersistSuccess>('Event persisted', {
			path: filePath.data,
			entry,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown persist error';

		return failed(`Failed to persist event: ${message}`);
	}
}
