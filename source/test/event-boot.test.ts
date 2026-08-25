import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
	bootStateFromEventLog,
	createDefaultEvents,
	getBootNavigationTarget,
} from '../lib/event/event-boot.js';
import {AppEvent} from '../lib/event/event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState, patchState} from '../lib/state/state.js';
import {bigIntToHex, midRank} from '../lib/utils/rank.js';

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

vi.mock('../lib/event/event-persist.js', () => ({
	persist: vi.fn(() => ({
		result: 'success',
		message: 'mocked persist',
		data: null,
	})),
	resolveEpiqRoot: vi.fn((dir?: string) => dir ?? process.cwd()),
}));

vi.mock('../lib/event/event-materialize-and-persist.js', async () => {
	const actual = await vi.importActual<
		typeof import('../lib/event/event-materialize.js')
	>('../lib/event/event-materialize.js');

	return {
		materializeAndPersistAll: vi.fn((events: readonly AppEvent[]) =>
			actual.materializeAll(events),
		),
	};
});

const actor = {
	userId: 'u1',
	userName: 'alice',
};

let eventSeq = 0;

const event = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): Extract<AppEvent, {action: A}> =>
	({
		id: `event-${++eventSeq}`,
		action,
		payload,
		...actor,
	} as Extract<AppEvent, {action: A}>);

beforeEach(() => {
	eventSeq = 0;

	const rankResult = bigIntToHex(1n);
	if (isFail(rankResult)) throw new Error(rankResult.message);

	initWorkspaceState(
		nodes.workspace('test-root', 'Test Root', rankResult.value),
	);
});

describe('event boot', () => {
	// `init` persists these directly, so `ensureContributorCurrent` never sees
	// them. Without a registration here the initializer authors the whole
	// default board while absent from the registry.
	it('registers the initializing user as a contributor', () => {
		const result = createDefaultEvents({
			userId: 'userId',
			userName: 'username',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		// Second, after `init.workspace`: registering first throws on a cold
		// state, because nothing has initialized the state it writes into.
		const registration = result.value[1];
		if (registration?.action !== 'create.contributor') {
			throw new Error('Expected a default event registering the author');
		}

		expect(registration.payload).toEqual({id: 'userId', name: 'username'});
	});

	it('creates the default workspace events', () => {
		const result = createDefaultEvents({
			userId: 'userId',
			userName: 'username',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		const events = result.value;

		expect(events).toHaveLength(10);
		expect(events.map(e => e.action)).toEqual([
			'init.workspace',
			'create.contributor',
			'add.board',
			'add.swimlane',
			'add.swimlane',
			'add.swimlane',
			'add.board',
			'add.swimlane',
			'lock.node',
			'lock.node',
		]);

		const closedBoardEvent = events[6];
		const closedSwimlaneEvent = events[7];
		const lockClosedBoardEvent = events[8];
		const lockClosedSwimlaneEvent = events[9];

		if (
			closedBoardEvent?.action !== 'add.board' ||
			closedSwimlaneEvent?.action !== 'add.swimlane' ||
			lockClosedBoardEvent?.action !== 'lock.node' ||
			lockClosedSwimlaneEvent?.action !== 'lock.node'
		) {
			throw new Error('Unexpected default event shape');
		}

		expect(closedBoardEvent.payload.id).toBe(CLOSED_BOARD_ID);
		expect(closedSwimlaneEvent.payload.id).toBe(CLOSED_SWIMLANE_ID);
		expect(lockClosedBoardEvent.payload.id).toBe(CLOSED_BOARD_ID);
		expect(lockClosedSwimlaneEvent.payload.id).toBe(CLOSED_SWIMLANE_ID);
	});

	it('boots from provided event log when workspace init exists', () => {
		const eventLog = [
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
				rank: rank(),
			}),
			event('add.swimlane', {
				id: 'swimlane-1',
				name: 'Todo',
				parent: 'board-1',
				rank: rank(),
			}),
		] as const;

		const result = bootStateFromEventLog([...eventLog]);

		expect(isFail(result)).toBe(false);
		expect(getState().nodes['workspace-1']).toBeDefined();
		expect(getState().nodes['board-1']?.parentNodeId).toBe('workspace-1');
		expect(getState().nodes['swimlane-1']?.parentNodeId).toBe('board-1');
	});

	// Replay converges over events it cannot apply, so an unreadable one no
	// longer locks anything. Locking left a board permanently unopenable
	// whenever the action came from a build that never shipped, and "upgrade
	// epiq" was then advice nobody could follow.
	describe('unreadable events are reported, not enforced', () => {
		const log = () =>
			[
				event('init.workspace', {
					id: 'workspace-1',
					name: 'Workspace',
					rank: rank(),
				}),
				event('add.board', {
					id: 'board-1',
					name: 'Board',
					parent: 'workspace-1',
					rank: rank(),
				}),
				event('add.swimlane', {
					id: 'swimlane-1',
					name: 'Todo',
					parent: 'board-1',
					rank: rank(),
				}),
			] as const;

		it('leaves the board writable whether or not the event can be placed', () => {
			const result = bootStateFromEventLog(
				[...log()],
				[
					{
						eventId: '01H0000000000000000000000Z',
						reason: 'unknown-action',
						detail: 'future.mystery.action',
						targetNodeId: 'board-1',
					},
					{
						eventId: '01H0000000000000000000000Y',
						reason: 'unsupported-schema-version',
						detail: 'v2',
						targetNodeId: null,
					},
				],
			);

			expect(isFail(result)).toBe(false);
			expect(getState().readOnly).toBe(false);
			expect(getState().readOnlyReason).toBeUndefined();
			expect(getState().nodes['board-1']?.readonly).toBe(false);
			expect(getState().nodes['swimlane-1']?.readonly).toBe(false);
		});

		it('leaves everything writable when nothing was unreadable', () => {
			const result = bootStateFromEventLog([...log()]);

			expect(isFail(result)).toBe(false);
			expect(getState().readOnly).toBe(false);
			expect(getState().nodes['board-1']?.readonly).toBe(false);
		});
	});

	// A re-boot rebuilds from the live head and resets readOnly/timeMode, so
	// without this guard any caller silently cancels an active checkout.
	describe.each(['peek', 'replay'] as const)(
		'while checked out in %s mode',
		timeMode => {
			const historicalLog = [
				event('init.workspace', {
					id: 'workspace-1',
					name: 'Workspace',
					rank: rank(),
				}),
			] as const;

			const liveLog = [
				...historicalLog,
				event('add.board', {
					id: 'board-live',
					name: 'Added after the checkout',
					parent: 'workspace-1',
					rank: rank(),
				}),
			] as const;

			it('does not re-materialize the live head over the checkout', () => {
				bootStateFromEventLog([...historicalLog]);
				patchState({timeMode, readOnly: true});

				const result = bootStateFromEventLog([...liveLog]);

				// Succeeds, not fails: state is loaded, just historical.
				expect(isFail(result)).toBe(false);
				expect(getState().nodes['board-live']).toBeUndefined();
			});

			it('leaves timeMode and readOnly untouched', () => {
				bootStateFromEventLog([...historicalLog]);
				patchState({timeMode, readOnly: true});

				bootStateFromEventLog([...liveLog]);

				expect(getState().timeMode).toBe(timeMode);
				expect(getState().readOnly).toBe(true);
			});
		},
	);

	it('still boots normally when live', () => {
		patchState({timeMode: 'live', readOnly: false});

		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('add.board', {
				id: 'board-live',
				name: 'Board',
				parent: 'workspace-1',
				rank: rank(),
			}),
		]);

		expect(isFail(result)).toBe(false);
		expect(getState().nodes['board-live']).toBeDefined();
	});

	it('returns the first swimlane as boot navigation target when available', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
				rank: rank(),
			}),
			event('add.swimlane', {
				id: 'swimlane-1',
				name: 'Todo',
				parent: 'board-1',
				rank: rank(),
			}),
		]);

		expect(isFail(result)).toBe(false);

		const targetResult = getBootNavigationTarget();
		if (isFail(targetResult)) throw targetResult;

		expect(targetResult.value.contextNode?.id).toBe('swimlane-1');
		expect(targetResult.value.selectedIndex).toBe(-1);
	});

	it('returns the first board as boot navigation target when no swimlane exists', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
				rank: rank(),
			}),
		]);

		expect(isFail(result)).toBe(false);

		const targetResult = getBootNavigationTarget();
		if (isFail(targetResult)) throw targetResult;

		expect(targetResult.value.contextNode?.id).toBe('board-1');
		expect(targetResult.value.selectedIndex).toBe(0);
	});

	// An event naming state this replay never applied is the ordinary result of
	// a merge, or of skipping an action this build does not know. Failing the
	// boot for one means a single concurrent edit leaves a board that never
	// opens again — and for whoever's build understands the most.
	it('skips an event whose target does not exist instead of failing boot', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('edit.title', {
				id: 'missing-node',
				name: 'Nope',
			}),
		]);

		expect(isFail(result)).toBe(false);
		expect(getState().nodes['workspace-1']).toBeDefined();
	});

	// The bug that prompted the split: a rename that arrives after a tombstone
	// for the same contributor. Tombstone wins, and the board still opens.
	it('skips a rename that lost to a tombstone', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			event('create.contributor', {id: 'c1', name: 'Bob'}),
			event('tombstone.contributor', {id: 'c1'}),
			event('rename.contributor', {id: 'c1', name: 'Rob'}),
		]);

		expect(isFail(result)).toBe(false);
		expect(getState().contributors['c1']?.name).toBe('removed');
	});

	// A broken actor is not a lost race, so it still stops the boot.
	it('still fails boot on a corrupt event', () => {
		// The handler has to succeed for the actor check to be reached: it runs
		// after materialization, so a precondition failure short-circuits it.
		const corrupt = {
			...event('add.board', {
				id: 'board-9',
				name: 'Board',
				parent: 'workspace-1',
				rank: rank(),
			}),
			userId: '',
			userName: '',
		} as AppEvent;

		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
				rank: rank(),
			}),
			corrupt,
		]);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('Materializing failed');
		}
	});
});
