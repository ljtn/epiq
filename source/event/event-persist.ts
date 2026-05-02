import fs from 'node:fs';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getSettingsState, User} from '../lib/state/settings.state.js';
import {
	ensureEventsDir,
	getEventsDirPath,
	resolveClosestEpiqRoot,
} from '../lib/storage/paths.js';
import {getEdgeRef} from './event-load.js';
import {
	AppEvent,
	AppEventMap,
	StoredAppEvent,
	stripActor,
} from './event.model.js';

// ======================
// Increment this if we make any non-backwards-compatible changes to the event schema, so we can handle old vs new formats in event loading.
// ======================
const SCHEMA_VERSION = 1;
// ======================

const getNextId = monotonicFactory();

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

export const getPersistFileName = ({userId, userName}: User): string =>
	`${sanitizeFilePart(userId)}.${sanitizeFilePart(userName)}.jsonl`;

export const getEventLogPath = (
	epiqRoot: string,
	{userId, userName}: User,
): Result<string> => {
	const fileName = getPersistFileName({userId, userName});
	const isValid = /^(?!.*\.jsonl.*\.jsonl).*\.jsonl$/.test(fileName);
	if (!isValid) return failed(`Invalid event log file name: ${fileName}`);

	const logPath = path.join(getEventsDirPath(epiqRoot), fileName);
	return succeeded('Successfully resolved event log path', logPath);
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
		const resolvedRootResult = resolveClosestEpiqRoot(rootDir);
		if (isFail(resolvedRootResult)) return resolvedRootResult;

		const ensureEventsDirResult = ensureEventsDir(resolvedRootResult.value);
		if (isFail(ensureEventsDirResult)) return ensureEventsDirResult;

		const filePath = getEventLogPath(resolvedRootResult.value, {
			userId: event.userId,
			userName: event.userName,
		});
		if (isFail(filePath)) return filePath;

		const edgeRef = getEdgeRef(resolvedRootResult.value);
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
