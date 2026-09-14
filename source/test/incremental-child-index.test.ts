import {beforeEach, describe, expect, it} from 'vitest';

import {materializeAll} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {groupChildrenByParent} from '../lib/repository/children.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState, patchState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

// A write inside a batch rebuilds the child lists of the parents it touched
// and no others: regrouping every node per write is what made a write on a
// large board cost most of a second. The untouched lists keep their identity
// — which is what a full rebuild cannot give — and the whole index still
// equals a full regrouping, whatever the write did.

const IDS = {
	root: '01H00000000000000000000000',
	board: '01H00000000000000000000002',
	laneA: '01H00000000000000000000003',
	laneB: '01H00000000000000000000004',
} as const;

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

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
		userName: 'alice',
	} as Extract<AppEvent, {action: A}>);

const ticketId = (n: number) =>
	`01H0000000000000000010${String(n).padStart(4, '0')}`;

const apply = (events: AppEvent[]) => {
	for (const result of materializeAll(events)) {
		if (isFail(result)) throw new Error(result.message);
	}
};

const fullIndex = () => groupChildrenByParent(getState().nodes, []);

beforeEach(() => {
	seq = 0;
	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rank()));

	apply([
		event('add.board', {
			id: IDS.board,
			name: 'Board',
			parent: IDS.root,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: IDS.laneA,
			name: 'A',
			parent: IDS.board,
			rank: '000000000000000000000001',
		}),
		event('add.swimlane', {
			id: IDS.laneB,
			name: 'B',
			parent: IDS.board,
			rank: '000000000000000000000002',
		}),
		...[1, 2, 3].map(n =>
			event('add.issue', {
				id: ticketId(n),
				name: `Ticket ${n}`,
				parent: IDS.laneA,
				rank: `00000000000000000000000${n}`,
			}),
		),
	]);
});

describe('the child index across a batched write', () => {
	it('rebuilds only the lists the write touched', () => {
		const before = getState().renderedChildrenIndex;

		apply([
			event('move.node', {
				id: ticketId(2),
				parent: IDS.laneB,
				rank: '000000000000000000000001',
			}),
		]);

		const after = getState().renderedChildrenIndex;

		// Both lanes changed; the board's list of lanes did not.
		expect(after[IDS.board]).toBe(before[IDS.board]);
		expect(after[IDS.laneA]).not.toBe(before[IDS.laneA]);
		expect(after[IDS.laneA]?.map(n => n.id)).toEqual([
			ticketId(1),
			ticketId(3),
		]);
		expect(after[IDS.laneB]?.map(n => n.id)).toEqual([ticketId(2)]);
		expect(after).toEqual(fullIndex());
	});

	it('drops a list whose last child left, and equals a full regrouping', () => {
		apply([
			event('move.node', {
				id: ticketId(1),
				parent: IDS.laneB,
				rank: '000000000000000000000001',
			}),
			event('move.node', {
				id: ticketId(2),
				parent: IDS.laneB,
				rank: '000000000000000000000002',
			}),
			event('move.node', {
				id: ticketId(3),
				parent: IDS.laneB,
				rank: '000000000000000000000003',
			}),
			event('delete.node', {id: ticketId(2)}),
			event('edit.title', {id: ticketId(3), name: 'Renamed'}),
		]);

		const index = getState().renderedChildrenIndex;

		expect(index[IDS.laneA]).toBeUndefined();
		expect(index[IDS.laneB]?.map(n => n.title)).toEqual([
			'Ticket 1',
			'Renamed',
		]);
		expect(index).toEqual(fullIndex());
	});

	it('regroups everything when the node map itself was replaced', () => {
		const before = getState().renderedChildrenIndex;
		const {nodes: current} = getState();

		// What tombstoneNode does: a copied map, handed over whole.
		patchState({nodes: {...current}});

		const after = getState().renderedChildrenIndex;

		expect(after).not.toBe(before);
		expect(after).toEqual(fullIndex());
	});

	it('regroups everything while a filter narrows the board', () => {
		patchState({
			filters: [{target: 'title', operator: '=', value: 'Ticket 1'}],
		});

		apply([
			event('move.node', {
				id: ticketId(3),
				parent: IDS.laneB,
				rank: '000000000000000000000001',
			}),
		]);

		const index = getState().renderedChildrenIndex;

		expect(index[IDS.laneA]?.map(n => n.id)).toEqual([ticketId(1)]);
		expect(index[IDS.laneB]).toBeUndefined();
	});
});
