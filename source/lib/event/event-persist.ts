import fs from 'node:fs';
import path from 'node:path';
import {decodeTime, monotonicFactory} from 'ulid';
import {logger} from '../../logger.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {ensureEventsDir, getEventsDirPath} from '../storage/paths.js';
import {sanitizeFilePart} from '../utils/file-part.js';
import {MAX_ULID_AHEAD_MS} from './date-utils.js';
import {
	CompositeId,
	PersistedEvent,
	toPersistedEvent,
} from './event-envelope.js';
import {Loader} from './event-load.js';
import {Actor, Event, EventMap, stripActor} from './event.model.js';
import {noteOwnAppend} from './log-signature.js';
import {
	actorSegmentOf,
	appendPendingLine,
	getPendingLogPath,
	isPendingFileName,
} from './pending-log.js';

// The largest timestamp ULID can encode. An id at this value has no encodable
// successor.
const ULID_TIME_MAX = 281474976710655;

// An edge further ahead than this would, via `Math.max` below, become the
// lower bound of every id minted by every client from then on, permanently.
const MAX_EDGE_AHEAD_MS = MAX_ULID_AHEAD_MS;

/**
 * The edge's time is only a lower bound for the next id; order comes from `refId`.
 * An undecodable or maxed-out edge falls back to the wall clock, or the log could never be written again.
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

// The id alone; names are resolved by id. Older `<id>.<name>.jsonl` files still
// load, pinned by `old-log-file-names.test.ts`.
export const getPersistFileName = ({userId}: Actor): string =>
	`${sanitizeFilePart(userId)}.jsonl`;

// Every tracked log this actor owns, current name last: an older
// `<id>.<name>.jsonl` may still hold uncommitted lines.
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

	// The owner is the id segment, under either naming.
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
	{userId}: Actor,
): Result<string> => {
	const fileName = getPersistFileName({userId});
	const isValid = /^(?!.*\.jsonl.*\.jsonl).*\.jsonl$/.test(fileName);
	if (!isValid) return failed(`Invalid event log file name: ${fileName}`);

	const logPath = path.join(getEventsDirPath(epiqRoot), fileName);
	return succeeded('Successfully resolved event log path', logPath);
};

// A batch's edge: resolved by the first persist that needs it (`undefined` =
// unresolved, `null` = empty log), then advanced per event.
export type EdgeCursor = {current?: string | null};

/** Writes lines for one log, sharing the loader that knows the edge. */
export const createPersister = <M extends EventMap>(loader: Loader<M>) => {
	const getNextId = monotonicFactory();

	/**
	 * Mints an id past the edge, which becomes its parent. Separate so the state
	 * applies the event under the same id the log will carry.
	 */
	function mintEventId(
		rootDir: string,
		edge?: EdgeCursor,
	): Result<CompositeId> {
		let edgeValue: string | null;
		if (edge && edge.current !== undefined) {
			edgeValue = edge.current;
		} else {
			const edgeRef = loader.getEdgeRef(rootDir);
			if (isFail(edgeRef)) return failed(edgeRef.message);
			edgeValue = edgeRef.value;
		}

		const newId = edgeValue
			? getNextId(seedFromEdgeRef(edgeValue))
			: getNextId();

		return succeeded('Minted event id', [newId, edgeValue]);
	}

	function persist({
		event,
		rootDir,
		edge,
		id,
	}: {
		event: Event<M>;
		rootDir: string;
		edge?: EdgeCursor;
		// The identity a caller already minted, so it could apply the event
		// under it. Minted here when absent — the same rule either way.
		id?: CompositeId;
	}): Result<{path: string; entry: PersistedEvent<M>}> {
		try {
			const ensureEventsDirResult = ensureEventsDir(rootDir);
			if (isFail(ensureEventsDirResult)) return ensureEventsDirResult;

			// The line goes to the untracked pending file beside the tracked log, so git
			// cannot reset it away; a sync folds it in.
			const trackedPath = getEventLogPath(rootDir, {
				userId: event.userId,
			});
			if (isFail(trackedPath)) return trackedPath;

			const filePath = getPendingLogPath(
				rootDir,
				path.basename(trackedPath.value),
			);

			const identity = id
				? succeeded('Minted event id', id)
				: mintEventId(rootDir, edge);
			if (isFail(identity)) return failed(identity.message);

			const [newId, edgeValue] = identity.value;

			const entryResult = toPersistedEvent<M>(stripActor(event), [
				newId,
				edgeValue,
			]);

			if (isFail(entryResult)) return failed(entryResult.message);

			const line = `${JSON.stringify(entryResult.value)}\n`;
			appendPendingLine(filePath, line);

			// Advanced only after the line is on disk, so a failed persist leaves
			// the cursor pointing at an event that exists.
			if (edge) edge.current = newId;

			// Advances the cached edge for the next write, unless another actor's file moved.
			const fileName = path.basename(filePath);

			loader.advanceEdgeRef(rootDir, fileName, newId, Buffer.byteLength(line));

			// Already materialized, so this append leaves the process up to date.
			noteOwnAppend(rootDir, fileName, Buffer.byteLength(line));

			return succeeded('Event persisted', {
				path: filePath,
				entry: entryResult.value,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown persist error';

			return failed(`Failed to persist event: ${message}`);
		}
	}

	return {mintEventId, persist};
};

export type Persister<M extends EventMap> = ReturnType<
	typeof createPersister<M>
>;
