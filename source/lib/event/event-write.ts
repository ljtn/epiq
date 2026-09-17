import {
	failed,
	isFail,
	Result,
	resultStatuses,
	succeeded,
} from '../model/result-types.js';
import {EventCatalog} from './event-catalog.js';
import {Materializer} from './event-materialize.js';
import {EdgeCursor, Persister} from './event-persist.js';
import {ActionOf, Event, EventMap, MaterializeResult} from './event.model.js';

type NonEmptyArray<T> = [T, ...T[]];

type MaterializedValue<M extends EventMap, A extends ActionOf<M>> = {
	action: A;
	result: M[A]['result'];
};

/**
 * The write path: apply to state and append to the log, under one identity.
 */
export const createWriter = <M extends EventMap>(
	catalog: EventCatalog<M>,
	materializer: Materializer<M>,
	persister: Persister<M>,
) => {
	/**
	 * The id a caller builds an event with is a placeholder: the real one is
	 * minted here, against the edge the event will follow, before the state
	 * sees it. So what a node's log holds is what its line in the file holds,
	 * and the state this leaves behind is the state replaying that line
	 * produces.
	 *
	 * Minted before materializing rather than after persisting, because a live
	 * write whose precondition fails must leave the log untouched — an event
	 * appended and then rejected would be skipped by every replay, for good.
	 */
	function materializeAndPersist<A extends ActionOf<M>>(
		event: Event<M, A>,
		rootDir: string,
		edge?: EdgeCursor,
	): MaterializeResult<M, A> {
		const id = persister.mintEventId(rootDir, edge);
		if (isFail(id)) return failed(id.message);

		const identified: Event<M, A> = {...event, id: id.value[0]};

		const materialized = materializer.materialize(identified);

		if (materialized.status !== resultStatuses.Success) {
			return materialized;
		}

		const persistResult = persister.persist({
			event: identified,
			rootDir,
			edge,
			id: id.value,
		});
		if (isFail(persistResult)) return persistResult;

		return materialized;
	}

	function materializeAndPersistAll<const T extends Event<M>[]>(
		events: T,
		rootDir: string,
	): Result<NonEmptyArray<MaterializedValue<M, T[number]['action']>>> {
		if (events.length === 0 || !events[0]) {
			return failed('No events provided');
		}

		// Every write passes through here, so the state is held read-only once
		// rather than in each caller.
		const readOnlyReason = catalog.write.readOnlyReason();
		if (readOnlyReason) return failed(readOnlyReason);

		// One batch for the whole write. Each event, and whatever the product
		// derives from it, otherwise rebuilds on its own — seven derivations to
		// write one event, each over everything the state holds.
		const batched = catalog.replay.batch(
			(): Result<NonEmptyArray<MaterializedValue<M, T[number]['action']>>> => {
				// One cursor for the whole batch: the loop below is synchronous, so
				// nothing in this process appends between two of its persists.
				const edge: EdgeCursor = {};

				const before = catalog.write.beforeWrite(events[0]!, event =>
					materializeAndPersist(event, rootDir, edge),
				);
				if (isFail(before)) return failed(before.message);

				const results = events.map(event =>
					materializeAndPersist(event, rootDir, edge),
				);

				const failures = results.filter(isFail);
				if (failures.length > 0) {
					return failed(
						'Materialize and persist failed: ' +
							failures.map(result => result.message).join(', '),
					);
				}

				return succeeded(
					'Materialization succeeded',
					results.map(result => result.value) as NonEmptyArray<
						MaterializedValue<M, T[number]['action']>
					>,
				);
			},
		);

		if (isFail(batched)) return failed(batched.message);

		return batched.value ?? failed('Materialize and persist produced nothing');
	}

	return {materializeAndPersist, materializeAndPersistAll};
};
