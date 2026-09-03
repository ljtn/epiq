import {describe, expect, it, vi} from 'vitest';
import {Filter} from '../lib/model/app-state.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {ticketMatchesFilter} from '../lib/utils/filter.js';

// Authorship is not on the node — it is only ever in the log — so the actor
// filter is the one filter that reads events rather than props.

const TICKET = '01KS22YK9AXCMATZXTR5JZCS5M';
const OTHER = '01KS22YK9AXCMATZXTR5JZCS5N';

const PETER = 'HVK8KMV924DBNFBDQV8RCZ9S06';
const FRED = 'HVK8KMV924DBNFBDQV8RCZ9S07';

const event = (
	userId: string,
	action: string,
	payload: Record<string, unknown>,
) => ({id: ['x', null], userId, userName: 'ignored', action, payload});

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({
		tags: {},
		contributors: {
			[PETER]: {id: PETER, name: 'claude/peter'},
			[FRED]: {id: FRED, name: 'codex/fred'},
			unregistered: {id: 'unregistered', name: ''},
		},
		eventLog: [
			event(PETER, 'add.ticket', {id: TICKET, name: 'Fix bug'}),
			event(FRED, 'add.issue.comment', {id: 'c1', issue: TICKET, md: 'hi'}),
			event(FRED, 'add.ticket', {id: OTHER, name: 'Other'}),
			// A contributor event naming its own id, which is not a node.
			event(PETER, 'create.contributor', {id: PETER, name: 'claude/peter'}),
			// An author the registry has never seen.
			event('ghost', 'edit.ticket.title', {id: TICKET, title: 'Fix bug'}),
		],
	}),
}));

const ticket = nodes.ticket(TICKET, 'Fix bug', 'lane', 'a0');
const other = nodes.ticket(OTHER, 'Other', 'lane', 'a1');

const byActor = (value: string): Filter => ({
	target: 'actor',
	operator: '=',
	value,
});

describe('actor filter', () => {
	it('matches the actor who created the ticket', () => {
		expect(ticketMatchesFilter(ticket, byActor('claude/peter'))).toBe(true);
	});

	// The case the filter exists for: an agent that worked a ticket it did not
	// open still counts as having worked it.
	it('matches an actor who only commented', () => {
		expect(ticketMatchesFilter(ticket, byActor('codex/fred'))).toBe(true);
	});

	it('does not match an actor who never touched the ticket', () => {
		expect(ticketMatchesFilter(other, byActor('claude/peter'))).toBe(false);
	});

	it('matches on a partial name, like the other filters', () => {
		expect(ticketMatchesFilter(ticket, byActor('peter'))).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(ticketMatchesFilter(ticket, byActor('CLAUDE/PETER'))).toBe(true);
	});

	// The slash is what separates provider from name, and the log file name
	// cannot hold it — so a filter that only saw file names would never match.
	it('matches across the provider separator', () => {
		expect(ticketMatchesFilter(ticket, byActor('claude/'))).toBe(true);
	});

	it('does not match a name no contributor holds', () => {
		expect(ticketMatchesFilter(ticket, byActor('claude/nobody'))).toBe(false);
	});

	// Resolved through the registry by id: an id with no registry entry has no
	// name to match, rather than falling back to the log's sanitized file name.
	it('ignores an author the registry does not know', () => {
		expect(ticketMatchesFilter(ticket, byActor('ghost'))).toBe(false);
	});

	// An id is unique across kinds, so an event naming a contributor or tag id
	// must never be read as touching a ticket.
	it('does not treat a contributor id as a node it touched', () => {
		expect(ticketMatchesFilter(other, byActor('codex/fred'))).toBe(true);
		expect(ticketMatchesFilter(other, byActor('claude/peter'))).toBe(false);
	});

	it('matches every ticket when the query is empty', () => {
		expect(ticketMatchesFilter(ticket, byActor(''))).toBe(true);
	});
});
