import {beforeEach, describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAll} from '../lib/board/board-log.js';
import {CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';
import {getIssueComments} from '../mcp/api/state.js';

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value as T;
};

const TICKET = '01J00000000000000000000T01';
const GONE = '01J00000000000000000000T02';

let n = 0;
const event = (action: string, payload: object) =>
	({
		id: `01J00000000000000000${String(++n).padStart(6, '0')}`,
		action,
		payload,
		userId: 'u1',
	} as AppEvent);

beforeEach(() => {
	n = 0;
	unwrap(
		initWorkspaceState(nodes.workspace('root', 'Root', unwrap(midRank()))),
	);
	const defaults = unwrap(
		createDefaultEvents({userId: 'u1', userName: 'one'}),
	) as AppEvent[];
	const lane = (
		defaults.find(
			e =>
				e.action === 'add.swimlane' &&
				(e.payload as {id: string}).id !== CLOSED_SWIMLANE_ID,
		)!.payload as {id: string}
	).id;
	const rank = unwrap(midRank());

	materializeAll([
		...defaults,
		event('add.issue', {id: TICKET, name: 'Open', parent: lane, rank}),
		event('add.issue', {id: GONE, name: 'Gone', parent: lane, rank}),
		event('add.issue.comment', {
			id: '01J00000000000000000000C01',
			issue: TICKET,
			author: 'u1',
			md: 'First',
		}),
		event('add.issue.comment', {
			id: '01J00000000000000000000C02',
			issue: TICKET,
			author: 'u1',
			md: 'Dropped',
		}),
		event('delete.issue.comment', {
			id: '01J00000000000000000000C02',
			issue: TICKET,
		}),
		event('add.issue.comment', {
			id: '01J00000000000000000000C03',
			issue: GONE,
			author: 'u1',
			md: 'On it',
		}),
		event('delete.node', {id: GONE}),
	]);
});

describe("an open ticket's comments", () => {
	it('are its live ones, shaped as the board sends them', () => {
		const comments = unwrap(getIssueComments(TICKET));

		expect(comments.map(comment => comment.body)).toEqual(['First']);
		expect(comments[0]).toMatchObject({
			id: '01J00000000000000000000C01',
			issueId: TICKET,
			body: 'First',
			author: {id: 'u1'},
		});
	});

	it('are none for a deleted or unknown ticket', () => {
		expect(unwrap(getIssueComments(GONE))).toEqual([]);
		expect(unwrap(getIssueComments('nope'))).toEqual([]);
	});
});
