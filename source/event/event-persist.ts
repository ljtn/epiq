import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {z} from 'zod';
import {getEpiqDirName} from '../init.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getSettingsState, User} from '../lib/state/settings.state.js';
import {getEdgeRef} from './event-load.js';
import {
	AppEvent,
	AppEventMap,
	StoredAppEvent,
	stripActor,
} from './event.model.js';

const GLOBAL_EPIQ_ROOT = path.resolve(os.homedir(), '.epiq');

// ======================
// Increment this if we make any non-backwards-compatible changes to the event schema, so we can handle old vs new formats in event loading.
// ======================
const SCHEMA_VERSION = 1;
// ======================

const getNextId = monotonicFactory();

const EVENTS_DIR = 'events';

type Id = string;
type RefId = string;
export type CompositeId = [Id, RefId | null];

type PersistedPayloadMap = {
	[K in keyof AppEventMap]: AppEventMap[K]['payload'];
};

export type PersistedEvent = {
	v: 1;
	id: CompositeId;
} & {
	[K in keyof PersistedPayloadMap]: {
		[P in K]: PersistedPayloadMap[P];
	};
}[keyof PersistedPayloadMap];

type PersistSuccess = {
	path: string;
	entry: PersistedEvent;
};

const CompositeIdSchema = z.tuple([
	z.string().min(1),
	z.string().min(1).nullable(),
]);

export const PersistedEventSchema = z.looseObject({
	v: z.literal(SCHEMA_VERSION),
	id: CompositeIdSchema,
});

export const parsePersistedEvent = (value: unknown): Result<PersistedEvent> => {
	const result = PersistedEventSchema.safeParse(value);

	if (!result.success) {
		return failed(
			`Invalid persisted event: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed persisted event', result.data as PersistedEvent);
};

const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'unknown';

export const resolveActorId = (): Result<User> => {
	const {userName, userId} = getSettingsState();
	if (!userName) return failed('User name not configured');
	if (!userId) return failed('User ID not configured');

	if (userName.trim()) {
		return succeeded('Successfully resolved actor ID', {
			userId: sanitizeFilePart(userId),
			userName: sanitizeFilePart(userName),
		});
	}

	return failed('Unable to resolve actor ID from settings or OS user info');
};

const isGlobalEpiqRoot = (candidate: string): boolean =>
	path.resolve(candidate) === GLOBAL_EPIQ_ROOT;

const hasLocalEpiqDir = (dir: string): boolean => {
	const candidate = path.join(dir, getEpiqDirName());

	return (
		!isGlobalEpiqRoot(candidate) &&
		fs.existsSync(candidate) &&
		fs.statSync(candidate).isDirectory()
	);
};

export const resolveEpiqRoot = (startDir: string): string => {
	let currentDir = path.resolve(startDir);

	while (true) {
		if (hasLocalEpiqDir(currentDir)) return currentDir;

		const parentDir = path.dirname(currentDir);

		if (parentDir === currentDir) {
			return path.resolve(startDir);
		}

		currentDir = parentDir;
	}
};

const getEventsDir = (rootDir: string): string =>
	path.join(resolveEpiqRoot(rootDir), getEpiqDirName(), EVENTS_DIR);

export const getPersistFileName = ({userId, userName}: User): string =>
	`${sanitizeFilePart(userId)}.${sanitizeFilePart(userName)}.jsonl`;

export const getEventLogPath = (
	rootDir: string,
	{userId, userName}: User,
): Result<string> => {
	const fileName = getPersistFileName({userId, userName});
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
	id: CompositeId,
): Result<PersistedEvent> => {
	const candidate = {
		[event.action]: event.payload,
		v: SCHEMA_VERSION,
		id,
	};

	return parsePersistedEvent(candidate);
};

export function persist({
	event,
	rootDir = process.cwd(),
}: {
	event: AppEvent;
	rootDir?: string;
}): Result<PersistSuccess> {
	try {
		const resolvedRoot = resolveEpiqRoot(rootDir);
		const dir = getEventsDir(resolvedRoot);

		const filePath = getEventLogPath(resolvedRoot, {
			userId: event.userId,
			userName: event.userName,
		});

		if (isFail(filePath)) return filePath;

		fs.mkdirSync(dir, {recursive: true});

		const edgeRef = getEdgeRef(resolvedRoot);
		if (isFail(edgeRef)) return failed(edgeRef.message);

		const newId = edgeRef.value
			? getNextId(Math.max(Date.now(), decodeTime(edgeRef.value) + 1))
			: getNextId();

		const entryResult = toPersistedEvent(stripActor(event), [
			newId,
			edgeRef.value,
		]);

		if (isFail(entryResult)) return failed(entryResult.message);

		fs.appendFileSync(
			filePath.value,
			`${JSON.stringify(entryResult.value)}\n`,
			'utf8',
		);

		return succeeded<PersistSuccess>('Event persisted', {
			path: filePath.value,
			entry: entryResult.value,
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown persist error';

		return failed(`Failed to persist event: ${message}`);
	}
}
