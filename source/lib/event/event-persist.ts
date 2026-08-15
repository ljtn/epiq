import fs from 'node:fs';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSettingsState, User} from '../state/settings.state.js';
import {ensureEventsDir, getEventsDirPath} from '../storage/paths.js';
import {sanitizeFilePart} from '../utils/file-part.js';
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

const isValidUserId = (value: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

const isValidUserName = (value: string) =>
	value.trim().length > 0 && value.length <= 80;

export const resolveActorId = (): Result<User> => {
	const {userName, userId} = getSettingsState();

	if (!userName) return failed('User name not configured');
	if (!userId) return failed('User ID not configured');

	if (!isValidUserId(userId)) {
		return failed('Invalid user ID in config');
	}

	if (!isValidUserName(userName)) {
		return failed('Invalid user name in config');
	}

	return succeeded('Successfully resolved actor ID', {
		userId,
		userName,
	});
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
	rootDir,
}: {
	event: AppEvent;
	rootDir: string;
}): Result<PersistSuccess> {
	try {
		const ensureEventsDirResult = ensureEventsDir(rootDir);
		if (isFail(ensureEventsDirResult)) return ensureEventsDirResult;

		const filePath = getEventLogPath(rootDir, {
			userId: event.userId,
			userName: event.userName,
		});
		if (isFail(filePath)) return filePath;

		const edgeRef = getEdgeRef(rootDir);
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
