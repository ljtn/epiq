import {describe, expect, it, vi} from 'vitest';
import {Filter} from '../lib/model/app-state.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {ticketMatchesFilter} from '../lib/utils/filter.js';
import {nodeRef, nodeRefMatches} from '../lib/utils/node-ref.js';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({tags: {}, contributors: {}}),
}));

const ULID = '01KS22YK9AXCMATZXTR5JZCS5M';

describe('nodeRef', () => {
	it('derives the reference from the last 7 characters of the ulid', () => {
		expect(nodeRef(ULID)).toBe('5JZCS5M');
	});

	it('matches case-insensitively, tolerating a typed hyphen', () => {
		expect(nodeRefMatches(ULID, '5JZCS5M')).toBe(true);
		expect(nodeRefMatches(ULID, '5jz-cs5m')).toBe(true);
		expect(nodeRefMatches(ULID, 'zcs5')).toBe(true);
		expect(nodeRefMatches(ULID, '5JZCS5X')).toBe(false);
	});
});

describe('ref materialization and filtering', () => {
	const ticket: NavNode<'TICKET'> = nodes.ticket(ULID, 'Fix bug', 'lane', 'a0');

	it('materializes the ref onto the ticket props', () => {
		expect(ticket.props.ref).toBe('5JZCS5M');
	});

	it('materializes the ref onto the board props', () => {
		const board = nodes.board(ULID, 'Default', 'workspace', 'a0');
		expect(board.props.ref).toBe('5JZCS5M');
	});

	it('filters tickets by ref', () => {
		const filter: Filter = {target: 'ref', operator: '=', value: '5JZCS5M'};
		expect(ticketMatchesFilter(ticket, filter)).toBe(true);

		const miss: Filter = {target: 'ref', operator: '=', value: 'AAAAAAA'};
		expect(ticketMatchesFilter(ticket, miss)).toBe(false);
	});
});
