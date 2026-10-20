import {decodeTime, ulid} from 'ulid';
import {describe, expect, it} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	deriveBoardOverview,
	OverviewTicket,
} from '../lib/stats/board-overview.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 20, 12);
const ago = (days: number) => now - days * DAY;

const event = (
	action: string,
	parent: string,
	daysAgo: number,
	userId: string,
): AppEvent =>
	({
		id: ulid(ago(daysAgo)),
		action,
		payload: {id: 'x', parent, rank: 'a'},
		userId,
	} as unknown as AppEvent);

// Filed when its first event was.
const ticket = (
	id: string,
	parentNodeId: string,
	log: AppEvent[],
): OverviewTicket => ({
	id,
	parentNodeId,
	log,
	createdAt: decodeTime(log[0]!.id),
});

const overview = (tickets: OverviewTicket[]) =>
	deriveBoardOverview({
		boardId: 'board',
		lanes: [
			{id: 'todo', title: 'Todo'},
			{id: 'review', title: 'Review'},
		],
		tickets,
		now,
	});

describe('a board overview', () => {
	const tickets = [
		ticket('t1', 'todo', [event('add.issue', 'todo', 10, 'u1')]),
		ticket('t2', 'review', [
			event('add.issue', 'todo', 20, 'u1'),
			event('move.node', 'review', 2, 'u2'),
		]),
		ticket('t3', 'closed', [
			event('add.issue', 'todo', 14, 'u2'),
			event('close.issue', 'closed', 7, 'u1'),
		]),
		// Sent back from Review before it closed.
		ticket('t6', 'closed', [
			event('add.issue', 'todo', 30, 'u1'),
			event('move.node', 'review', 25, 'u1'),
			event('move.node', 'todo', 20, 'u2'),
			event('close.issue', 'closed', 3, 'u1'),
		]),
		// Another board's, and an old one whose filing is outside the window.
		ticket('t4', 'elsewhere', [event('add.issue', 'elsewhere', 1, 'u3')]),
		ticket('t5', 'todo', [event('add.issue', 'todo', 60, 'u3')]),
	];

	it('weighs what was filed against what was closed, and how much went back', () => {
		const {filed, closed, sentBackShare} = overview(tickets);

		// t5 was filed before the window, t4 on another board.
		expect(filed).toBe(4);
		expect(closed).toBe(2);
		expect(sentBackShare).toBe(0.5);
	});

	it("splits a closed ticket's time across the lanes it stood in", () => {
		// t3 spent 7 days in Todo; t6 spent 5 + 17 there and 5 in Review.
		expect(overview(tickets).laneTime).toEqual([
			{laneId: 'todo', title: 'Todo', meanMs: 14.5 * DAY, share: 29 / 34},
			{laneId: 'review', title: 'Review', meanMs: 2.5 * DAY, share: 5 / 34},
		]);
	});

	it('counts closes from this board by week, with their lead time', () => {
		const {throughput, medianLeadTimeMs} = overview(tickets);

		expect(throughput).toHaveLength(8);
		expect(throughput.reduce((sum, week) => sum + week.closed, 0)).toBe(2);
		expect(medianLeadTimeMs).toBe(17 * DAY);
	});

	it('is empty for a board nobody has used', () => {
		const empty = overview([]);

		expect(empty.filed).toBe(0);
		expect(empty.sentBackShare).toBeNull();
		expect(empty.laneTime).toEqual([]);
		expect(empty.medianLeadTimeMs).toBeNull();
	});
});
