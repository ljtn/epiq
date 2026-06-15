import {ulid} from 'ulid';
import {
	failed,
	isFail,
	Result,
	resultStatuses,
	succeeded,
} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {materialize} from './event-materialize.js';
import {persist} from './event-persist.js';
import {
	AppEvent,
	AppEventMap,
	EventAction,
	MaterializeResult,
} from './event.model.js';

type NonEmptyArray<T> = [T, ...T[]];
type MaterializedValue<A extends EventAction> = {
	action: A;
	result: AppEventMap[A]['result'];
};

function materializeAndPersist<A extends EventAction>(
	event: AppEvent<A>,
	rootDir: string,
): MaterializeResult<A> {
	const materialized = materialize(event);

	if (materialized.status !== resultStatuses.Success) {
		return materialized;
	}

	const persistResult = persist({event, rootDir});
	if (isFail(persistResult)) return persistResult;

	return materialized;
}

export function materializeAndPersistAll<const T extends AppEvent[]>(
	events: T,
	rootDir: string,
): Result<NonEmptyArray<MaterializedValue<T[number]['action']>>> {
	if (events.length === 0 || !events[0]) {
		return failed('No events provided');
	}

	const contributorResult = ensureContributorExists(events[0], rootDir);

	if (isFail(contributorResult)) {
		return contributorResult;
	}

	const results = events.map(event => materializeAndPersist(event, rootDir));

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
			MaterializedValue<T[number]['action']>
		>,
	);
}

export const ensureContributorExists = (
	event: AppEvent,
	rootDir: string,
): Result<void> => {
	if (event.action === 'create.contributor') {
		return succeeded('Contributor already being created', undefined);
	}

	if (nodeRepo.getContributor(event.userId)) {
		return succeeded('Contributor exists', undefined);
	}

	const contributorEvent: AppEvent<'create.contributor'> = {
		id: ulid(),
		action: 'create.contributor',
		payload: {
			id: event.userId,
			name: event.userName,
		},
		userId: event.userId,
		userName: event.userName,
	};

	const result = materializeAndPersist(contributorEvent, rootDir);

	if (isFail(result)) {
		return failed(result.message);
	}

	return succeeded('Contributor created', undefined);
};
