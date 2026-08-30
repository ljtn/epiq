import {describe, expect, it, vi} from 'vitest';
import {Filter} from '../lib/model/app-state.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {ticketMatchesFilter} from '../lib/utils/filter.js';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({
		tags: {
			live: {id: 'live', name: 'bug'},
			gone: {id: 'gone', name: 'urgent', tombstoned: true},
		},
		contributors: {},
	}),
}));

describe('tag filter', () => {
	const ticket = {
		...nodes.ticket('01KS22YK9AXCMATZXTR5JZCS5M', 'Fix bug', 'lane', 'a0'),
	};
	ticket.props.tags = ['live', 'gone'];

	const byTag = (value: string): Filter => ({
		target: 'tag',
		operator: '=',
		value,
	});

	it('matches a live tag on the ticket', () => {
		expect(ticketMatchesFilter(ticket, byTag('bug'))).toBe(true);
	});

	// The reference is still on the ticket; only the tag has been deleted.
	it('ignores a deleted tag the ticket still references', () => {
		expect(ticketMatchesFilter(ticket, byTag('urgent'))).toBe(false);
	});
});
