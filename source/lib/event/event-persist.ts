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

// The largest timestamp ULID can encode. An id at this value has no encodable
// successor.
const ULID_TIME_MAX = 281474976710655;

/**
 * The edge's timestamp is a lower bound for the next id and nothing more —
 * ordering comes from `refId`, not from this number.
 *
 * An edge whose id does not decode, or decodes to ULID's ceiling, has no
 * usable successor: `decodeTime(edge) + 1` either throws on the spot or
 * exceeds what `encodeTime` accepts. Letting that fail the mint left the board
 * permanently unwritable on every machine at once, with no way back, because
 * the log is append-only. So fall back to the wall clock rather than refuse.
 * Neither shape can be produced by a well-behaved writer.
 */
const seedFromEdgeRef = (edgeRef: string): number => {
	const now = Date.now();

	let edgeTime: number;
	try {
		edgeTime = decodeTime(edgeRef);
	} catch {
		return now;
	}

	if (edgeTime >= ULID_TIME_MAX) return now;

	return Math.max(now, edgeTime + 1);
};

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

// Stable across every schema version, so ancestry stays readable on a line
// whose payload is not. Only the payload may change shape.
export const PersistedEnvelopeSchema = z.looseObject({
	v: z.number().int().positive(),
	id: CompositeIdSchema,
});

export type PersistedEnvelope = z.infer<typeof PersistedEnvelopeSchema>;

export const parsePersistedEnvelope = (
	value: unknown,
): Result<PersistedEnvelope> => {
	const result = PersistedEnvelopeSchema.safeParse(value);

	if (!result.success) {
		return failed(
			`Invalid persisted event envelope: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed persisted event envelope', result.data);
};

// Versions this build can decode, listed one by one rather than `<=
// SCHEMA_VERSION`: if a bump changes the shape of an existing payload, write
// the migration before adding the version here.
const READABLE_SCHEMA_VERSIONS = [1] as const;

// Fails to compile if a version bump forgets to add itself to the list above. So: fail compile time instead of runtime.
const _assertCurrentVersionReadable: typeof SCHEMA_VERSION extends (typeof READABLE_SCHEMA_VERSIONS)[number]
	? true
	: never = true;
void _assertCurrentVersionReadable;

const readableSchemaVersions: ReadonlySet<number> = new Set(
	READABLE_SCHEMA_VERSIONS,
);

// Readability only; an unsupported event is still part of the history.
export const isSupportedSchemaVersion = (version: number): boolean =>
	readableSchemaVersions.has(version);

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
			? getNextId(seedFromEdgeRef(edgeRef.value))
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
