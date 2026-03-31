import {cmdResult, failed} from '../lib/command-line/command-types.js';
import {materialize, MaterializeResults} from './event-materialize.js';
import {persist} from './event-persist.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';

export function materializeAndPersist<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	const materializeResult = materialize(event);
	if (materializeResult.result !== cmdResult.Success) {
		return materializeResult;
	}

	const persistResult = persist(event);
	if (persistResult.result !== cmdResult.Success) {
		return failed(persistResult.message ?? 'Failed to persist event');
	}

	return materializeResult;
}

export function materializeAndPersistAll<const T extends readonly AppEvent[]>(
	events: T,
): MaterializeResults<T> {
	return events.map(event =>
		materializeAndPersist(event),
	) as MaterializeResults<T>;
}
