import {beforeEach, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/command-line/command-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {nodeRepo} from '../repository/node-repo.js';
import {AppEvent} from '../event/event.model.js';
import {materialize, materializeAll} from '../event/event-materialize.js';
import {CLOSED_SWIMLANE_ID} from '../event/static-ids.js';

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

const expectOk = (result: any) => {
	expect(isFail(result)).toBe(false);
};

const setupWorkspace = () => {
	const results = materializeAll([
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
		event('add.swimlane', {
			id: CLOSED_SWIMLANE_ID,
			name: 'Closed',
			parent: 'board-1',
		}),
		event('add.issue', {
			id: 'issue-1',
			name: 'Issue',
			parent: 'swimlane-1',
		}),
	] as const);

	for (const result of results) {
		expectOk(result);
	}
};

beforeEach(() => {
	eventSeq = 0;
	initWorkspaceState(nodes.workspace('test-root', 'Test Root'));
});

describe('event materialize', () => {
	it('materializes workspace, board, swimlane, and issue events', () => {
		setupWorkspace();

		expect(nodeRepo.getNode('workspace-1')).toBeDefined();
		expect(nodeRepo.getNode('board-1')?.parentNodeId).toBe('workspace-1');
		expect(nodeRepo.getNode('swimlane-1')?.parentNodeId).toBe('board-1');
		expect(nodeRepo.getNode('issue-1')?.parentNodeId).toBe('swimlane-1');
	});

	it('renames a node from edit.title without failing', () => {
		setupWorkspace();

		const result = materialize(
			event('edit.title', {
				id: 'issue-1',
				name: 'Renamed issue',
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode('issue-1')).toBeDefined();
	});

	it('fails edit.title when node does not exist', () => {
		const result = materialize(
			event('edit.title', {
				id: 'missing-node',
				name: 'Nope',
			}),
		);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('edit title failed');
		}
	});

	it('moves an issue to another swimlane', () => {
		setupWorkspace();

		expectOk(
			materialize(
				event('add.swimlane', {
					id: 'swimlane-2',
					name: 'Doing',
					parent: 'board-1',
				}),
			),
		);

		const result = materialize(
			event('move.node', {
				id: 'issue-1',
				parent: 'swimlane-2',
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode('issue-1')?.parentNodeId).toBe('swimlane-2');
	});

	it('closes an issue by moving it to the closed swimlane', () => {
		setupWorkspace();

		const result = materialize(
			event('close.issue', {
				id: 'issue-1',
				parent: 'parent-1',
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode('issue-1')?.parentNodeId).toBe(CLOSED_SWIMLANE_ID);
	});

	it('fails closing an already closed issue', () => {
		setupWorkspace();

		expectOk(
			materialize(event('close.issue', {id: 'issue-1', parent: 'parent-1'})),
		);

		const result = materialize(
			event('close.issue', {id: 'issue-1', parent: 'parent-1'}),
		);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('cannot close closed issue');
		}
	});

	it('logs events on affected nodes by default', () => {
		setupWorkspace();

		const rename = event('edit.title', {
			id: 'issue-1',
			name: 'Logged rename',
		});

		const result = materialize(rename);

		expectOk(result);
		expect(
			nodeRepo.getNode('issue-1')?.log?.some(entry => entry.id === rename.id),
		).toBe(true);
	});

	it('does not log events when bypassLogging is true', () => {
		setupWorkspace();

		const rename = event('edit.title', {
			id: 'issue-1',
			name: 'Unlogged rename',
		});

		const result = materialize(rename, true);

		expectOk(result);
		expect(
			nodeRepo.getNode('issue-1')?.log?.some(entry => entry.id === rename.id),
		).toBe(false);
	});

	it('fails after successful handler when actor identity is invalid', () => {
		setupWorkspace();

		const result = materialize({
			...event('edit.title', {
				id: 'issue-1',
				name: 'Bad actor',
			}),
			userId: '',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('invalid user id format');
		}
	});

	it('materializeAll returns one result per event', () => {
		const events = [
			event('init.workspace', {
				id: 'workspace-1',
				name: 'Workspace',
			}),
			event('add.board', {
				id: 'board-1',
				name: 'Board',
				parent: 'workspace-1',
			}),
		] as const;

		const results = materializeAll(events);

		expect(results).toHaveLength(2);
		expect(results.every(result => !isFail(result as Result))).toBe(true);
	});
});
