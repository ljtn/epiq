// The four figures the identity panel shows, counted off the log.
//
// The derivation is pure, so this is the whole of it: no repository, no board,
// no git. What it cannot answer — the commit total — is handed in by
// `mcp/api/personal-stats.ts` and belongs to the author scan's own tests.

import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {AppEvent} from '../lib/board/board-events.model.js';
import {authoredTotals} from '../lib/stats/personal-stats.js';

const ME = '01HQZZZZZZZZZZZZZZZZZZZZZZ';
const SOMEBODY_ELSE = '01HQYYYYYYYYYYYYYYYYYYYYYY';

const at = (iso: string) => ulid(new Date(iso).getTime());

const ticket = (userId: string, id = ulid()): AppEvent<'add.issue'> => ({
	id,
	userId,
	action: 'add.issue',
	payload: {id: ulid(), name: 'A ticket', parent: 'lane', rank: 'a'},
});

// `author` on the payload is always the actor (`addIssueComment` sets it from
// the same place), so the two agree; the count goes by `userId` like the
// ticket count, which is the log's own attribution.
const comment = (
	userId: string,
	id = ulid(),
): AppEvent<'add.issue.comment'> => ({
	id,
	userId,
	action: 'add.issue.comment',
	payload: {id: ulid(), issue: 'issue', author: userId, md: 'a comment'},
});

const rename = (userId: string, id = ulid()): AppEvent<'edit.title'> => ({
	id,
	userId,
	action: 'edit.title',
	payload: {id: 'issue', name: 'A better title'},
});

describe('authoredTotals', () => {
	it('counts only what this person created', () => {
		const totals = authoredTotals(
			[
				ticket(ME),
				ticket(ME),
				ticket(SOMEBODY_ELSE),
				comment(ME),
				comment(SOMEBODY_ELSE),
				comment(SOMEBODY_ELSE),
				// Not a ticket and not a comment, however many of them there are.
				rename(ME),
				rename(ME),
			],
			ME,
		);

		expect(totals.tickets).toBe(2);
		expect(totals.comments).toBe(1);
	});

	it('joins somebody at their earliest event, whatever it was', () => {
		const first = at('2024-03-01T09:00:00Z');

		const totals = authoredTotals(
			[
				// Out of order on purpose: the log is sorted causally, not by time,
				// so the earliest is a minimum rather than the first line.
				ticket(ME, at('2024-06-01T09:00:00Z')),
				rename(ME, first),
				comment(ME, at('2024-04-01T09:00:00Z')),
				// Somebody else was here first, which says nothing about me.
				ticket(SOMEBODY_ELSE, at('2020-01-01T09:00:00Z')),
			],
			ME,
		);

		expect(totals.joinedAt).toBe(new Date('2024-03-01T09:00:00Z').getTime());
	});

	it('reports nobody who has done nothing rather than a date', () => {
		const totals = authoredTotals([ticket(SOMEBODY_ELSE)], ME);

		expect(totals).toEqual({tickets: 0, comments: 0, joinedAt: null});
	});

	it('survives an id it cannot decode, losing only that event’s date', () => {
		const good = at('2024-05-01T09:00:00Z');

		const totals = authoredTotals(
			[ticket(ME, 'not-a-ulid'), ticket(ME, good)],
			ME,
		);

		// Both still count; only the undecodable one contributes no date.
		expect(totals.tickets).toBe(2);
		expect(totals.joinedAt).toBe(new Date('2024-05-01T09:00:00Z').getTime());
	});
});
