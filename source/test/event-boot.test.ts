import {beforeEach, describe, expect, it, vi} from 'vitest';
import {isFail} from '../lib/model/result-types.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	bootStateFromEventLog,
	createDefaultEvents,
	getBootNavigationTarget,
	hasPendingDefaultEvents,
	persistPendingDefaultEvents,
} from '../lib/event/event-boot.js';
import {AppEvent} from '../lib/event/event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';

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
	initWorkspaceState(nodes.workspace('test-root', 'Test Root'));
});

describe('event boot', () => {
	it('creates the default workspace events', () => {
		const events = createDefaultEvents();

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

		expect(events[5]?.payload.id).toBe(CLOSED_BOARD_ID);
		expect(events[6]?.payload.id).toBe(CLOSED_SWIMLANE_ID);
		expect(events[7]?.payload.id).toBe(CLOSED_BOARD_ID);
		expect(events[8]?.payload.id).toBe(CLOSED_SWIMLANE_ID);
	});

	it('boots default state when event log has no workspace init event', () => {
		const result = bootStateFromEventLog([]);

		expect(isFail(result)).toBe(false);
		expect(hasPendingDefaultEvents()).toBe(true);

		const state = getState();
		const workspace = Object.values(state.nodes).find(
			node => node.context === 'WORKSPACE',
		);
		const closedBoard = state.nodes[CLOSED_BOARD_ID];
		const closedSwimlane = state.nodes[CLOSED_SWIMLANE_ID];

		expect(workspace).toBeDefined();
		expect(closedBoard).toBeDefined();
		expect(closedSwimlane).toBeDefined();
		expect(closedSwimlane?.parentNodeId).toBe(CLOSED_BOARD_ID);
	});

	it('boots from provided event log when workspace init exists', () => {
		const eventLog = [
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
			}),
			event('add.swimlane', {
				id: 'swimlane-1',
				name: 'Todo',
				parent: 'board-1',
			}),
		] as const;

		const result = bootStateFromEventLog([...eventLog]);

		expect(isFail(result)).toBe(false);
		expect(hasPendingDefaultEvents()).toBe(false);
		expect(getState().nodes['workspace-1']).toBeDefined();
		expect(getState().nodes['board-1']?.parentNodeId).toBe('workspace-1');
		expect(getState().nodes['swimlane-1']?.parentNodeId).toBe('board-1');
	});

	it('returns the first swimlane as boot navigation target when available', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
			}),
			event('add.swimlane', {
				id: 'swimlane-1',
				name: 'Todo',
				parent: 'board-1',
			}),
		]);

		expect(isFail(result)).toBe(false);

		const target = getBootNavigationTarget();

		expect(target.currentNode?.id).toBe('swimlane-1');
		expect(target.selectedIndex).toBe(-1);
	});

	it('returns the first board as boot navigation target when no swimlane exists', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
			}),
		]);

		expect(isFail(result)).toBe(false);

		const target = getBootNavigationTarget();

		expect(target.currentNode?.id).toBe('board-1');
		expect(target.selectedIndex).toBe(0);
	});

	it('persists pending default events and clears the pending flag', () => {
		const bootResult = bootStateFromEventLog([]);

		expect(isFail(bootResult)).toBe(false);
		expect(hasPendingDefaultEvents()).toBe(true);

		const persistResult = persistPendingDefaultEvents();

		if (isFail(persistResult)) {
			console.log(persistResult.message);
		}

		expect(isFail(persistResult)).toBe(false);
		expect(hasPendingDefaultEvents()).toBe(false);
	});

	it('returns success when there are no pending default events to persist', () => {
		const result = persistPendingDefaultEvents();

		expect(isFail(result)).toBe(false);
		expect(hasPendingDefaultEvents()).toBe(false);
	});

	it('fails boot when event materialization fails', () => {
		const result = bootStateFromEventLog([
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
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
