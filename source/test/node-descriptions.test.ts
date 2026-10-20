import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {materializeAll} from '../lib/board/board-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';

// A board's or lane's description is an edit.description on its id. Every
// build applies it to the node, so replay must take it whatever the node's
// fate, and nothing ticket-shaped may grow from it.

const IDS = {
	root: '01H00000000000000000000000',
	workspace: '01H00000000000000000000001',
	board: '01H00000000000000000000002',
	lane: '01H00000000000000000000003',
} as const;

let seq = 0;

const event = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): Extract<AppEvent, {action: A}> =>
	({
		id: `01H00000000000000000${String(++seq).padStart(6, '0')}`,
		action,
		payload,
		userId: 'u1',
	} as Extract<AppEvent, {action: A}>);

const setup = (): AppEvent[] => [
	event('init.workspace', {id: IDS.workspace, name: 'Workspace', rank: 'a'}),
	event('add.board', {
		id: IDS.board,
		name: 'Board',
		parent: IDS.workspace,
		rank: 'a',
	}),
	event('add.swimlane', {
		id: IDS.lane,
		name: 'Todo',
		parent: IDS.board,
		rank: 'a',
	}),
];

const replay = (log: AppEvent[]) => {
	const rank = bigIntToHex(1n);
	if (isFail(rank)) throw new Error(rank.message);

	initWorkspaceState(nodes.workspace(IDS.root, 'Root', rank.value));
	materializeAll(log);

	return getState();
};

const descriptionOf = (id: string) =>
	(getState().nodes[id]?.props as {description?: string} | undefined)
		?.description;

beforeEach(() => {
	seq = 0;
	setVirtualNodesEnabled(true);
});

afterEach(() => {
	setVirtualNodesEnabled(false);
});

describe('board and lane descriptions on replay', () => {
	it('lands on the lane and the board, the later edit winning', () => {
		replay([
			...setup(),
			event('edit.description', {id: IDS.board, md: 'Board rules'}),
			event('edit.description', {id: IDS.lane, md: 'First'}),
			event('edit.description', {id: IDS.lane, md: 'Second'}),
		]);

		expect(descriptionOf(IDS.board)).toBe('Board rules');
		expect(descriptionOf(IDS.lane)).toBe('Second');
	});

	it('grows no virtual fields under a lane or a board', () => {
		const before = Object.keys(replay(setup()).nodes).sort();
		const after = Object.keys(
			replay([
				...setup(),
				event('edit.description', {id: IDS.board, md: 'Board rules'}),
				event('edit.description', {id: IDS.lane, md: 'Lane rules'}),
			]).nodes,
		).sort();

		expect(after).toEqual(before);
	});

	it.each([
		['before', 0],
		['after', 1],
	] as const)(
		'keeps replaying past a lane deleted %s its description',
		(_, deleteAt) => {
			const edits: AppEvent[] = [
				event('edit.description', {id: IDS.lane, md: 'Rules'}),
			];
			edits.splice(deleteAt, 0, event('delete.node', {id: IDS.lane}));

			replay([
				...setup(),
				...edits,
				event('edit.description', {id: IDS.board, md: 'Still applied'}),
			]);

			expect(getState().nodes[IDS.lane]?.isDeleted).toBe(true);
			expect(descriptionOf(IDS.board)).toBe('Still applied');
		},
	);

	it('skips a description on a locked lane, as the Closed one is', () => {
		replay([
			...setup(),
			event('lock.node', {id: IDS.lane}),
			event('edit.description', {id: IDS.lane, md: 'Refused'}),
			event('edit.description', {id: IDS.board, md: 'Still applied'}),
		]);

		expect(descriptionOf(IDS.lane)).toBeUndefined();
		expect(descriptionOf(IDS.board)).toBe('Still applied');
	});
});
