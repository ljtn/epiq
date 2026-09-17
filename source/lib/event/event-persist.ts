import fs from 'node:fs';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {z} from 'zod';
import {logger} from '../../logger.js';
import {isValidUserId, isValidUserName} from '../config/actor-env.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSettingsState, User} from '../state/settings.state.js';
import {ensureEventsDir, getEventsDirPath} from '../storage/paths.js';
import {sanitizeFilePart} from '../utils/file-part.js';
import {MAX_ULID_AHEAD_MS} from './date-utils.js';
import {
	actorSegmentOf,
	appendPendingLine,
	getPendingLogPath,
	isPendingFileName,
} from './pending-log.js';
import {advanceEdgeRef, getEdgeRef} from './event-load.js';
import {noteOwnAppend} from './log-signature.js';
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

// An edge further ahead than this would, via `Math.max` below, become the
// lower bound of every id minted by every client from then on, permanently.
const MAX_EDGE_AHEAD_MS = MAX_ULID_AHEAD_MS;

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

	if (edgeTime > now + MAX_EDGE_AHEAD_MS) {
		logger.error(
			'[persist] edge id is too far in the future; seeding from the wall clock instead',
			{edgeRef, edgeTime, now},
		);
		return now;
	}

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

// The id alone. A display name on disk is a second place a name lives, and a
// git-tracked one: it survives `tombstone.contributor`, which can only clear
// the registry, and a rename starts a fresh file rather than changing the old
// ones. Names are resolved from the contributor registry by id.
//
// Files already carrying `<id>.<name>.jsonl` keep it and are read unchanged —
// `parseEventFileActor` splits on the first `.` and falls through when there
// is no separator, so both forms load. That reader shipped in v1.5.0, which
// is what this writer waited for.
export const getPersistFileName = ({userId}: Pick<User, 'userId'>): string =>
	`${sanitizeFilePart(userId)}.jsonl`;

// Every tracked log this actor owns, current name last. Normally that is one
// file, `<id>.jsonl`. A machine upgraded across ZFZFW9D can still hold the
// older `<id>.<name>.jsonl` beside it, and a line flushed into that one but
// never committed would otherwise never be staged again — the sync stages the
// actor's own log by name, and the name moved.
//
// Scoped to this actor's id, so it never reaches for anybody else's file.
export const ownEventFileNames = (
	eventsDir: string,
	current: string,
): string[] => {
	let entries: string[];
	try {
		if (!fs.existsSync(eventsDir)) return [current];

		entries = fs.readdirSync(eventsDir);
	} catch {
		return [current];
	}

	// The owner is the id segment, which is what a log's name carries whichever
	// naming it uses — the same question `flushPendingLogs` asks of a pending
	// file, answered in the one place.
	const wanted = actorSegmentOf(current);

	const legacy = entries.filter(name => {
		if (!name.endsWith('.jsonl') || name === current) return false;
		if (isPendingFileName(name)) return false;

		return actorSegmentOf(name) === wanted;
	});

	return [...legacy.sort(), current];
};

export const getEventLogPath = (
	epiqRoot: string,
	{userId}: Pick<User, 'userId'>,
): Result<string> => {
	const fileName = getPersistFileName({userId});
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
// A batch's edge, threaded through its persists: resolved from disk by the
// first persist that needs it (`undefined` = unresolved, `null` = empty log)
// and advanced in place per event, instead of re-reading and re-sorting the
// whole log every time.
export type EdgeCursor = {current?: string | null};

/**
 * The identity an event gets: an id minted past the edge it follows, and that
 * edge as its causal parent.
 *
 * Its own step because the board has to apply an event under the id the log
 * will carry. Materializing under one id and writing another leaves a board no
 * replay reproduces, and nothing that addresses an event by id — a ticket's log
 * row, a checkout of one — can match the two up.
 */
export function mintEventId(
	rootDir: string,
	edge?: EdgeCursor,
): Result<CompositeId> {
	let edgeValue: string | null;
	if (edge && edge.current !== undefined) {
		edgeValue = edge.current;
	} else {
		const edgeRef = getEdgeRef(rootDir);
		if (isFail(edgeRef)) return failed(edgeRef.message);
		edgeValue = edgeRef.value;
	}

	const newId = edgeValue ? getNextId(seedFromEdgeRef(edgeValue)) : getNextId();

	return succeeded('Minted event id', [newId, edgeValue]);
}

export function persist({
	event,
	rootDir,
	edge,
	id,
}: {
	event: AppEvent;
	rootDir: string;
	edge?: EdgeCursor;
	// The identity a caller already minted, so it could apply the event under
	// it. Minted here when absent — the same rule either way.
	id?: CompositeId;
}): Result<PersistSuccess> {
	try {
		const ensureEventsDirResult = ensureEventsDir(rootDir);
		if (isFail(ensureEventsDirResult)) return ensureEventsDirResult;

		// The tracked log's name is still what identifies this actor's file; the
		// line itself goes to the pending one beside it, which git does not
		// track and therefore cannot reset out from under a write. A sync folds
		// it in once git is finished with the worktree.
		const trackedPath = getEventLogPath(rootDir, {userId: event.userId});
		if (isFail(trackedPath)) return trackedPath;

		const filePath = succeeded(
			'Resolved pending event log path',
			getPendingLogPath(rootDir, path.basename(trackedPath.value)),
		);

		const identity = id
			? succeeded('Minted event id', id)
			: mintEventId(rootDir, edge);
		if (isFail(identity)) return failed(identity.message);

		const [newId, edgeValue] = identity.value;

		const entryResult = toPersistedEvent(stripActor(event), [newId, edgeValue]);

		if (isFail(entryResult)) return failed(entryResult.message);

		appendPendingLine(filePath.value, `${JSON.stringify(entryResult.value)}\n`);

		// Advanced only after the line is on disk, so a failed persist leaves
		// the cursor pointing at an event that exists.
		if (edge) edge.current = newId;

		// And the same for the next lone write, which would otherwise read the
		// whole log again to learn what this one just decided. Dropped rather
		// than advanced if another actor's file moved meanwhile — the tail is
		// then theirs to decide.
		const fileName = path.basename(filePath.value);

		advanceEdgeRef(rootDir, fileName, newId);

		// The board already has this event: materializing runs before persisting.
		// So the log growing by this line does not mean the process is behind it,
		// and the next read has nothing to catch up on.
		noteOwnAppend(rootDir, fileName);

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
