import {beforeAll, describe, expect, it} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAll} from '../lib/board/board-log.js';
import {Ticket} from '../lib/model/context.model.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {getVisibleCommentCount} from '../lib/utils/comment.utils.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {rank, unwrap} from './helpers/random-board-log.js';

// The TUI counts a ticket's comments as the GUI and MCP list them: from the
// comment store, where an edit after a delete brings the comment back.

let seq = 0;
const event = (action: string, payload: object) =>
	({
		id: `01H00000000000000000${String(++seq).padStart(6, '0')}`,
		action,
		payload,
		userId: 'u1',
	} as AppEvent);

beforeAll(() => setVirtualNodesEnabled(false));

describe("a ticket's comment count", () => {
	it('follows the comment store, an edit after a delete included', () => {
		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
		for (const result of materializeAll([
			event('add.board', {
				id: 'board',
				name: 'B',
				parent: 'root',
				rank: rank(),
			}),
			event('add.swimlane', {
				id: 'lane',
				name: 'L',
				parent: 'board',
				rank: rank(),
			}),
			event('add.issue', {
				id: 'ticket',
				name: 'T',
				parent: 'lane',
				rank: rank(),
			}),
			event('add.issue.comment', {
				id: 'c1',
				issue: 'ticket',
				author: 'u1',
				md: 'one',
			}),
			event('add.issue.comment', {
				id: 'c2',
				issue: 'ticket',
				author: 'u1',
				md: 'two',
			}),
			event('delete.issue.comment', {id: 'c1', issue: 'ticket'}),
			event('delete.issue.comment', {id: 'c2', issue: 'ticket'}),
			// Made by someone who had not seen the delete.
			event('edit.issue.comment', {
				id: 'c2',
				issue: 'ticket',
				md: 'two, again',
			}),
		])) {
			unwrap(result);
		}

		const ticket = nodeRepo.getNode('ticket') as Ticket;
		const listed = nodeRepo.getCommentsGroupedByIssue().get('ticket') ?? [];

		expect(listed.map(comment => comment.id)).toEqual(['c2']);
		expect(getVisibleCommentCount(ticket)).toBe(listed.length);
	});
});

// Who may delete an attachment is read from the store, so it must keep who
// added each one, as its add event says.
describe("an attachment's author", () => {
	it('is kept in the store, per attachment', () => {
		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
		const attach = (id: string, author: string) =>
			event('add.issue.attachment', {
				id,
				issue: 'ticket',
				hash: 'a'.repeat(64),
				ext: 'png',
				name: `${id}.png`,
				bytes: 1,
				author,
			});
		for (const result of materializeAll([
			event('add.board', {
				id: 'board',
				name: 'B',
				parent: 'root',
				rank: rank(),
			}),
			event('add.swimlane', {
				id: 'lane',
				name: 'L',
				parent: 'board',
				rank: rank(),
			}),
			event('add.issue', {
				id: 'ticket',
				name: 'T',
				parent: 'lane',
				rank: rank(),
			}),
			attach('a1', 'u1'),
			attach('a2', 'u2'),
		])) {
			unwrap(result);
		}

		expect(nodeRepo.getAttachment('a1')?.author).toBe('u1');
		expect(nodeRepo.getAttachment('a2')?.author).toBe('u2');
	});
});
