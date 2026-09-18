import {EventCatalog} from '../event/event-catalog.js';
import {
	CompositeId,
	parsePersistedEvent as parsePersistedEventOf,
	PersistedEvent as PersistedEventOf,
	toPersistedEvent as toPersistedEventOf,
} from '../event/event-envelope.js';
import {createEventLog} from '../event/event-log.js';
import {MaterializeResults as MaterializeResultsOf} from '../event/event-materialize.js';
import {Result} from '../model/result-types.js';
import {parseEventPayload} from './board-events.schema.js';
import {getState} from '../state/state.js';
import {ensureContributorCurrent} from './board-contributor.js';
import {
	AppEvent,
	AppEventMap,
	EVENT_ACTIONS,
	StoredAppEvent,
} from './board-events.model.js';
import {boardHandlers} from './board-materialize.js';
import {boardReplayHooks} from './board-replay.js';

// The board, as the event log sees it: which events exist, how each applies,
// what to keep beside the state as they do, and what has to hold before a
// write.
export const boardCatalog: EventCatalog<AppEventMap> = {
	genesis: 'init.workspace',
	actions: EVENT_ACTIONS,
	readPayload: parseEventPayload,
	apply: boardHandlers,
	replay: boardReplayHooks,
	write: {
		// `readOnly` marks a historical checkout, or a log this build cannot
		// fully read.
		readOnlyReason: () => {
			const state = getState();

			return state.readOnly
				? state.readOnlyReason ??
						'Cannot change the board while time travelling'
				: null;
		},
		beforeWrite: ensureContributorCurrent,
	},
};

export const boardLog = createEventLog(boardCatalog);

export const {
	materialize,
	materializeAll,
	fromPersistedEvent,
	decodeReconstructedEvents,
	loadMergedEventsWithUnreadable,
	loadEventActors,
	loadActorNames,
	loadMergedEvents,
	loadMergedEventsBefore,
	getEdgeRef,
	advanceEdgeRef,
	clearEdgeCache,
	getSortedEvents,
	loadEffectiveEventTimes,
	mintEventId,
	persist,
	materializeAndPersist,
	materializeAndPersistAll,
} = boardLog;

export type MaterializeResults<T extends readonly AppEvent[]> =
	MaterializeResultsOf<AppEventMap, T>;

// Bound to the board's map, so a caller gets the board's payloads rather than
// the `unknown` the unbound generic defaults to.
export type PersistedEvent = PersistedEventOf<AppEventMap>;

export const parsePersistedEvent = (value: unknown): Result<PersistedEvent> =>
	parsePersistedEventOf<AppEventMap>(value);

export const toPersistedEvent = (
	event: StoredAppEvent,
	id: CompositeId,
): Result<PersistedEvent> => toPersistedEventOf<AppEventMap>(event, id);

export {resolveActorId} from '../config/actor.js';
export {
	isSupportedSchemaVersion,
	type CompositeId,
} from '../event/event-envelope.js';
export {
	effectiveEventTimes,
	parsePersistedEventsFile,
	splitEventsAtTime,
	type ReconstructedEvent,
	type UnreadableEvent,
} from '../event/event-load.js';
export {
	isConvergenceFail,
	logSkippedEvents,
	partitionMaterializeResults,
} from '../event/event-materialize.js';
export {
	getEventLogPath,
	getPersistFileName,
	type EdgeCursor,
} from '../event/event-persist.js';
