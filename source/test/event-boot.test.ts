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
import {getState, initWorkspaceState} from '../lib/state/state.js';
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
	it('creates the default workspace events', () => {
		const result = createDefaultEvents({
			userId: 'userId',
			userName: 'username',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		const events = result.value;

		expect(events).toHaveLength(9);
		expect(events.map(e => e.action)).toEqual([
			'init.workspace',
			'add.board',
			'add.swimlane',
			'add.swimlane',
			'add.swimlane',
			'add.board',
			'add.swimlane',
			'lock.node',
			'lock.node',
		]);

		const closedBoardEvent = events[5];
		const closedSwimlaneEvent = events[6];
		const lockClosedBoardEvent = events[7];
		const lockClosedSwimlaneEvent = events[8];

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

		expect(targetResult.value.currentNode?.id).toBe('swimlane-1');
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

		expect(targetResult.value.currentNode?.id).toBe('board-1');
		expect(targetResult.value.selectedIndex).toBe(0);
	});

	it('fails boot when event materialization fails', () => {
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

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('Materializing failed');
			expect(result.message).toContain('edit title failed');
		}
	});
});
