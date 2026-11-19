import {beforeEach, describe, expect, it} from 'vitest';

import {materializeAll} from '../lib/board/board-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

// A delete copies the node map, never the nodes it leaves alone.

const IDS = {
	root: '01H00000000000000000000000',
	board: '01H00000000000000000000002',
	laneA: '01H00000000000000000000003',
	laneB: '01H00000000000000000000004',
} as const;

const ticketId = (n: number) =>
	`01H0000000000000000010${String(n).padStart(4, '0')}`;

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

const apply = (events: AppEvent[]) => {
	for (const result of materializeAll(events)) {
		if (isFail(result)) throw new Error(result.message);
	}
};

beforeEach(() => {
	seq = 0;
	const rank = midRank();
	if (isFail(rank)) throw new Error(rank.message);
	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rank.value));

	apply([
		event('add.board', {
			id: IDS.board,
			name: 'Board',
			parent: IDS.root,
			rank: rank.value,
		}),
		...[IDS.laneA, IDS.laneB].map((id, index) =>
			event('add.swimlane', {
				id,
				name: id,
				parent: IDS.board,
				rank: `00000000000000000000000${index + 1}`,
			}),
		),
		...[1, 2, 3].map(n =>
			event('add.issue', {
				id: ticketId(n),
				name: `Ticket ${n}`,
				parent: n === 3 ? IDS.laneB : IDS.laneA,
				rank: `00000000000000000000000${n}`,
			}),
		),
	]);
});

// The fixture's own nodes; a ticket's virtual fields go with it too.
const FIXTURE = [...Object.values(IDS), ticketId(1), ticketId(2), ticketId(3)];

const deleted = () =>
	FIXTURE.filter(id => getState().nodes[id]?.isDeleted).sort();

const virtualFieldsOf = (id: string) =>
	Object.values(getState().nodes).filter(node => node.parentNodeId === id);

describe('tombstoning a node', () => {
	it('on replay, takes its descendants and leaves every other node as it was', () => {
		const before = getState().nodes;

		apply([event('delete.node', {id: IDS.laneA})]);

		expect(deleted()).toEqual([IDS.laneA, ticketId(1), ticketId(2)].sort());
		for (const field of virtualFieldsOf(ticketId(2))) {
			expect(field.isDeleted).toBe(true);
		}

		const after = getState().nodes;
		expect(after[IDS.laneB]).toBe(before[IDS.laneB]);
		expect(after[ticketId(3)]).toBe(before[ticketId(3)]);
	});

	it('live, does the same', () => {
		const before = getState().nodes;

		const result = nodeRepo.tombstoneNode(IDS.laneA);
		expect(isFail(result)).toBe(false);

		expect(deleted()).toEqual([IDS.laneA, ticketId(1), ticketId(2)].sort());
		expect(getState().nodes[ticketId(3)]).toBe(before[ticketId(3)]);
	});

	it('does not reach through a child already tombstoned', () => {
		apply([event('delete.node', {id: ticketId(1)})]);
		const firstDelete = getState().nodes[ticketId(1)];

		apply([event('delete.node', {id: IDS.laneA})]);

		expect(getState().nodes[ticketId(1)]).toBe(firstDelete);
		expect(deleted()).toEqual([IDS.laneA, ticketId(1), ticketId(2)].sort());
	});
});
