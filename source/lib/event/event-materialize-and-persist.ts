import {resultStatuses, isFail} from '../model/result-types.js';
import {materialize} from './event-materialize.js';
import {persist} from './event-persist.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';

export function materializeAndPersist<A extends EventAction>(
	event: AppEvent<A>,
): MaterializeResult<A> {
	const materialized = materialize(event);

	if (materialized.status !== resultStatuses.Success) {
		return materialized;
	}

	const persistResult = persist({
		event,
	});
	if (isFail(persistResult)) return persistResult;

	return materialized;
}

export function materializeAndPersistAll<const T extends readonly AppEvent[]>(
	events: T,
) {
	return events.map(event => materializeAndPersist(event));
}
