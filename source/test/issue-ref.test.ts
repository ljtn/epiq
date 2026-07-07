import {describe, expect, it, vi} from 'vitest';
import {Filter} from '../lib/model/app-state.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {ticketMatchesFilter} from '../lib/utils/filter.js';
import {
	formatIssueRef,
	issueRef,
	issueRefMatches,
} from '../lib/utils/issue-ref.js';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({tags: {}, contributors: {}}),
}));

const ULID = '01KS22YK9AXCMATZXTR5JZCS5M';

describe('issueRef', () => {
	it('derives the reference from the last 7 characters of the ulid', () => {
		expect(issueRef(ULID)).toBe('5JZCS5M');
	});

	it('formats the display reference with a hyphen', () => {
		expect(formatIssueRef(ULID)).toBe('5JZ-CS5M');
	});

	it('matches with and without the display hyphen, case-insensitively', () => {
		expect(issueRefMatches(ULID, '5JZ-CS5M')).toBe(true);
		expect(issueRefMatches(ULID, '5jzcs5m')).toBe(true);
		expect(issueRefMatches(ULID, 'zcs5')).toBe(true);
		expect(issueRefMatches(ULID, '5JZ-CS5X')).toBe(false);
	});
});

describe('ticket ref materialization and filtering', () => {
	const ticket: NavNode<'TICKET'> = nodes.ticket(ULID, 'Fix bug', 'lane', 'a0');

	it('materializes the ref onto the ticket props', () => {
		expect(ticket.props.ref).toBe('5JZCS5M');
	});

	it('filters tickets by ref', () => {
		const filter: Filter = {target: 'ref', operator: '=', value: '5JZ-CS5M'};
		expect(ticketMatchesFilter(ticket, filter)).toBe(true);

		const miss: Filter = {target: 'ref', operator: '=', value: 'AAA-AAAA'};
		expect(ticketMatchesFilter(ticket, miss)).toBe(false);
	});
});
