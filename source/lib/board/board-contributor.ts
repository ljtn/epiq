import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getSettingsState} from '../state/settings.state.js';
import {AppEvent} from './board-events.model.js';

// Where a rename reaches the board: the registry only learns a name from an event.
export const ensureContributorCurrent = (
	event: AppEvent,
	writeOne: (event: AppEvent) => Result<unknown>,
): Result<void> => {
	if (
		event.action === 'create.contributor' ||
		event.action === 'rename.contributor'
	) {
		return succeeded('Contributor write already in flight', undefined);
	}

	// Only our own writes: our name on somebody else's event would rename them.
	const {userId: configuredId, userName} = getSettingsState();
	if (!userName || configuredId !== event.userId) {
		return succeeded('Not this actor own write', undefined);
	}

	const contributor = nodeRepo.getContributor(event.userId);

	const actorEvent: AppEvent<'create.contributor' | 'rename.contributor'> = {
		id: ulid(),
		action: contributor ? 'rename.contributor' : 'create.contributor',
		payload: {
			id: event.userId,
			name: userName,
		},
		userId: event.userId,
	};

	// A tombstoned name was cleared on purpose, so renaming would put it back.
	// `restore.contributor` is the way back.
	if (
		contributor &&
		(contributor.tombstoned || contributor.name === userName)
	) {
		return succeeded('Contributor name is current', undefined);
	}

	const result = writeOne(actorEvent);

	if (isFail(result)) {
		return failed(result.message);
	}

	return succeeded('Contributor name recorded', undefined);
};
