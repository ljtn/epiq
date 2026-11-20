import {beforeEach, describe, expect, it} from 'vitest';

import {materializeAll} from '../lib/board/board-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {isFail} from '../lib/model/result-types.js';
import {getOrderedChildren} from '../lib/repository/rank.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {loggedEvents} from '../lib/board/node-history.js';
import {midRank} from '../lib/utils/rank.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {Ticket} from '../lib/model/context.model.js';
import {ticketHistory} from '../lib/virtual-nodes/virtual-nodes.js';

// A ticket's detail rows in TUI draw order. The e2e suites navigate them by
// arrow count, so an inserted row should fail here first.

const IDS = {
	root: '01H00000000000000000000000',
	board: '01H00000000000000000000002',
	lane: '01H00000000000000000000003',
	ticket: '01H00000000000000000000004',
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
	} as Extract<AppEvent, {action: A}>);

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
		event('add.issue', {
			id: IDS.ticket,
			name: 'A ticket',
			parent: IDS.lane,
			rank: rank(),
		}),
	];

	for (const applied of materializeAll(log)) {
		if (isFail(applied)) throw new Error(applied.message);
	}
});

describe('a ticket’s virtual rows', () => {
	it('are in the order the detail view draws them', () => {
		expect(getOrderedChildren(IDS.ticket).map(child => child.title)).toEqual([
			'Description',
			'Assignees',
			'Tags',
			'History',
			'Diff',
			'Comments',
			'Attachments',
		]);
	});

	// Neither carries a value: Diff would need a git read, and History, a format
	// of every ticket's whole log, on every replay. Each is drawn when opened.
	it('leave Diff and History empty, for the view to draw when opened', () => {
		const rows = getOrderedChildren(IDS.ticket);

		const diff = rows.find(row => row.title === 'Diff');
		const history = rows.find(row => row.title === 'History');

		expect(diff?.props).toMatchObject({value: ''});
		expect(diff?.readonly).toBe(true);
		expect(history?.props).toMatchObject({value: ''});
		const ticket = nodeRepo.getNode(IDS.ticket) as Ticket;
		expect(
			ticketHistory(loggedEvents(ticket.history, getState().eventLog)),
		).toContain('Created with title');
	});
});
