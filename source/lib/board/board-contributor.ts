import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getSettingsState} from '../state/settings.state.js';
import {AppEvent} from './board-events.model.js';

// Where a rename reaches the board. Nothing on disk carries a display name —
// not the log's file name, not the event — so the registry only learns one
// from an event, and every write passes through here first.
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

	// Our own name and nobody else's. An event carries no name, so the only one
	// this process can vouch for is the identity it is configured with —
	// attaching that to somebody else's event would rename them.
	//
	// The settings store, which every surface fills at boot — the TUI and GUI
	// on start-up, the MCP in `boot()`. Reading config here instead would drag
	// the whole config module graph into every caller of this file.
	//
	// Read raw rather than through `resolveActorId`, whose extra validation is
	// about whether the config is well formed. The question here is only
	// whether this write is our own: an id that does not match is somebody
	// else's event, and attaching our name to it would rename them.
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
