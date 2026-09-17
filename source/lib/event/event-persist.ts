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
 * The edge's timestamp is a lower bound for the next id and nothing more —
 * ordering comes from `refId`, not from this number.
 *
 * An edge whose id does not decode, or decodes to ULID's ceiling, has no
 * usable successor: `decodeTime(edge) + 1` either throws on the spot or
 * exceeds what `encodeTime` accepts. Letting that fail the mint left the log
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

// The id alone. A display name on disk is a second place a name lives, and a
// git-tracked one: it survives a removal, which can only reach the product's
// own registry, and a rename starts a fresh file rather than changing the old
// ones. Names are resolved by id, wherever the product holds them.
//
// Files already carrying `<id>.<name>.jsonl` keep it and are read unchanged —
// `parseEventFileActor` splits on the first `.` and falls through when there
// is no separator, so both forms load. `old-log-file-names.test.ts` pins that
// contract; it is the one part of the format with no additive shape, because
// every client reads every other client's logs.
export const getPersistFileName = ({userId}: Actor): string =>
	`${sanitizeFilePart(userId)}.jsonl`;

// Every tracked log this actor owns, current name last. Normally that is one
// file, `<id>.jsonl`. A machine upgraded across the rename can still hold the
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
	{userId}: Actor,
): Result<string> => {
	const fileName = getPersistFileName({userId});
	const isValid = /^(?!.*\.jsonl.*\.jsonl).*\.jsonl$/.test(fileName);
	if (!isValid) return failed(`Invalid event log file name: ${fileName}`);

	const logPath = path.join(getEventsDirPath(epiqRoot), fileName);
	return succeeded('Successfully resolved event log path', logPath);
};

// A batch's edge, threaded through its persists: resolved from disk by the
// first persist that needs it (`undefined` = unresolved, `null` = empty log)
// and advanced in place per event, instead of re-reading and re-sorting the
// whole log every time.
export type EdgeCursor = {current?: string | null};

/**
 * Writes lines for one log. The loader is where the edge comes from, so the
 * two share an instance.
 */
export const createPersister = <M extends EventMap>(loader: Loader<M>) => {
	const getNextId = monotonicFactory();

	/**
	 * The identity an event gets: an id minted past the edge it follows, and
	 * that edge as its causal parent.
	 *
	 * Its own step because the state has to apply an event under the id the
	 * log will carry. Materializing under one id and writing another leaves a
	 * state no replay reproduces, and nothing that addresses an event by id — a
	 * node's own log, a checkout at one — can match the two up.
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

			// The tracked log's name is still what identifies this actor's file;
			// the line itself goes to the pending one beside it, which git does
			// not track and therefore cannot reset out from under a write. A sync
			// folds it in once git is finished with the worktree.
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

			appendPendingLine(filePath, `${JSON.stringify(entryResult.value)}\n`);

			// Advanced only after the line is on disk, so a failed persist leaves
			// the cursor pointing at an event that exists.
			if (edge) edge.current = newId;

			// And the same for the next lone write, which would otherwise read the
			// whole log again to learn what this one just decided. Dropped rather
			// than advanced if another actor's file moved meanwhile — the tail is
			// then theirs to decide.
			const fileName = path.basename(filePath);

			loader.advanceEdgeRef(rootDir, fileName, newId);

			// The state already has this event: materializing runs before
			// persisting. So the log growing by this line does not mean the
			// process is behind it, and the next read has nothing to catch up on.
			noteOwnAppend(rootDir, fileName);

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
