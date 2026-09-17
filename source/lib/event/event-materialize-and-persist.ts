import {ulid} from 'ulid';
import {
	failed,
	isFail,
	Result,
	resultStatuses,
	succeeded,
} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState, withDeferredDerive} from '../state/state.js';
import {materialize} from './event-materialize.js';
import {EdgeCursor, mintEventId, persist} from './event-persist.js';
import {getSettingsState} from '../state/settings.state.js';
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

/**
 * Applies an event to the board and writes it to the log, under one identity.
 *
 * The id a caller builds an event with is a placeholder: the real one is minted
 * here, against the edge the event will follow, before the board sees it. So
 * what a ticket's log holds is what its line in the file holds, and the state
 * this leaves behind is the state replaying that line produces.
 *
 * Minted before materializing rather than after persisting, because a live
 * write whose precondition fails must leave the log untouched — an event
 * appended and then rejected would be skipped by every replay, for good.
 */
function materializeAndPersist<A extends EventAction>(
	event: AppEvent<A>,
	rootDir: string,
	edge?: EdgeCursor,
): MaterializeResult<A> {
	const id = mintEventId(rootDir, edge);
	if (isFail(id)) return failed(id.message);

	const identified = {...event, id: id.value[0]};

	const materialized = materialize(identified);

	if (materialized.status !== resultStatuses.Success) {
		return materialized;
	}

	const persistResult = persist({
		event: identified,
		rootDir,
		edge,
		id: id.value,
	});
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

	// `readOnly` marks a historical checkout, or a log this build cannot fully
	// read. Every write passes through here, so the board is held read-only
	// once rather than in each caller.
	if (getState().readOnly) {
		return failed(
			getState().readOnlyReason ??
				'Cannot change the board while time travelling',
		);
	}

	// One derivation for the whole write. Each event, and each of the virtual
	// fields it refreshes, otherwise copies the node map and regroups the board
	// on its own — seven derivations to file one ticket, each over every node
	// the board has. Inside the batch the writes land in place and the flush
	// rebuilds only the parents they touched.
	const batched = withDeferredDerive(
		(): Result<NonEmptyArray<MaterializedValue<T[number]['action']>>> => {
			// One cursor for the whole batch: the loop below is synchronous, so
			// nothing in this process appends between two of its persists.
			const edge: EdgeCursor = {};

			const contributorResult = ensureContributorCurrent(
				events[0]!,
				rootDir,
				edge,
			);

			if (isFail(contributorResult)) {
				return failed(contributorResult.message);
			}

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
					MaterializedValue<T[number]['action']>
				>,
			);
		},
	);

	if (isFail(batched)) return failed(batched.message);

	return batched.value ?? failed('Materialize and persist produced nothing');
}

// Also where a rename reaches the board. The log file name is a sanitized
// storage key and cannot carry a display name, so the registry only learns a
// new one from an event, and this is the hook every write already passes
// through.
export const ensureContributorCurrent = (
	event: AppEvent,
	rootDir: string,
	edge?: EdgeCursor,
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

	const result = materializeAndPersist(actorEvent, rootDir, edge);

	if (isFail(result)) {
		return failed(result.message);
	}

	return succeeded('Contributor name recorded', undefined);
};
