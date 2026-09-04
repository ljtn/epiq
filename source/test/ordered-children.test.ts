import {beforeEach, describe, expect, it} from 'vitest';

import {materializeAll} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {orderChildrenOf} from '../lib/repository/children.js';
import {getOrderedChildren} from '../lib/repository/rank.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	getState,
	initWorkspaceState,
	patchState,
	withDeferredDerive,
} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

// Placing a new ticket asks for its parent's children and ranks it after the
// last of them. That answer is served from the index the board's derivation
// already built, rather than scanning every node again — which is only right
// where the index means the same thing as the scan.
//
// It does not always. The index is the *rendered* board: a filter narrows it,
// and inside a replay batch it is deliberately out of date. Ranking against
// either would put a ticket after the last visible sibling instead of the last
// one, landing it in the middle of the lane — and once written, the rank is
// what everyone else replays.

const IDS = {
	root: '01H00000000000000000000000',
	board: '01H00000000000000000000002',
	lane: '01H00000000000000000000003',
	tag: '01H00000000000000000000004',
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

beforeEach(() => {
	seq = 0;
	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rank()));

	const log: AppEvent[] = [
		event('add.board', {
			id: IDS.board,
			name: 'Board',
			parent: IDS.root,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: IDS.lane,
			name: 'Todo',
			parent: IDS.board,
			rank: rank(),
		}),
		event('create.tag', {id: IDS.tag, name: 'bug'}),
	];

	for (const n of [1, 2, 3]) {
		log.push(
			event('add.issue', {
				id: ticketId(n),
				name: `Ticket ${n}`,
				parent: IDS.lane,
				rank: rank(),
			}),
		);
	}

	log.push(event('add.issue.tag', {id: ticketId(2), tag: IDS.tag}));

	for (const applied of materializeAll(log)) {
		if (isFail(applied)) throw new Error(applied.message);
	}
});

const ids = (children: {id: string}[]) => children.map(child => child.id);

describe('a parent’s children, as rank resolution asks for them', () => {
	it('are what scanning the board for them gives', () => {
		expect(ids(getOrderedChildren(IDS.lane))).toEqual(
			ids(orderChildrenOf(getState().nodes, IDS.lane)),
		);
		expect(getOrderedChildren(IDS.lane)).toHaveLength(3);
	});

	// The case the index cannot answer: it holds the one ticket the filter
	// leaves on screen, and a rank taken from that would sit before the two it
	// hid.
	it('are every one of them while a filter narrows the board', () => {
		const patched = patchState({
			filters: [{target: 'tag', operator: '=', value: 'bug'}],
		});
		expect(isFail(patched)).toBe(false);

		expect(getState().renderedChildrenIndex[IDS.lane]).toHaveLength(1);
		expect(ids(getOrderedChildren(IDS.lane))).toEqual([
			ticketId(1),
			ticketId(2),
			ticketId(3),
		]);
	});

	// And inside a replay batch the index is whatever the last derivation left,
	// which is not what the events applied since then say.
	it('are the ones applied so far while a batch holds the derivation back', () => {
		const batched = withDeferredDerive(() => {
			for (const applied of materializeAll([
				event('add.issue', {
					id: ticketId(4),
					name: 'Ticket 4',
					parent: IDS.lane,
					rank: rank(),
				}),
			])) {
				if (isFail(applied)) throw new Error(applied.message);
			}

			return ids(getOrderedChildren(IDS.lane));
		});

		if (isFail(batched)) throw new Error(batched.message);

		expect(batched.value).toEqual([
			ticketId(1),
			ticketId(2),
			ticketId(3),
			ticketId(4),
		]);
	});
});
