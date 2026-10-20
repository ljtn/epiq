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

describe('a board overview, at its edges', () => {
	const lanes = [
		{id: 'todo', title: 'Todo'},
		{id: 'review', title: 'Review'},
	];
	const derive = (
		tickets: OverviewTicket[],
		options: {formerLaneIds?: string[]; lanes?: typeof lanes} = {},
	) =>
		deriveBoardOverview({
			boardId: 'board',
			lanes: options.lanes ?? lanes,
			formerLaneIds: options.formerLaneIds,
			tickets,
			now,
		});

	it('keeps work that passed through a lane deleted since', () => {
		const closed = ticket('t', 'closed', [
			event('add.issue', 'todo', 10, 'u'),
			event('move.node', 'gone', 6, 'u'),
			event('close.issue', 'closed', 2, 'u'),
		]);
		const result = derive([closed], {formerLaneIds: ['gone']});

		expect(result.closed).toBe(1);
		// Shown for the lanes that are left; the deleted one is not a row.
		expect(result.laneTime.map(lane => [lane.laneId, lane.meanMs])).toEqual([
			['todo', 4 * DAY],
		]);
	});

	it('counts a close stamped ahead of now in this week', () => {
		const ahead = ticket('t', 'closed', [
			event('add.issue', 'todo', 3, 'u'),
			event('close.issue', 'closed', -1 / 24, 'u'),
		]);
		const {closed, throughput} = derive([ahead]);

		expect(closed).toBe(1);
		expect(throughput.at(-1)?.closed).toBe(1);
	});

	it('counts a reopen into an earlier lane as sent back', () => {
		const reopened = ticket('t', 'closed', [
			event('add.issue', 'todo', 20, 'u'),
			event('move.node', 'review', 15, 'u'),
			event('close.issue', 'closed', 10, 'u'),
			event('reopen.issue', 'todo', 8, 'u'),
			event('close.issue', 'closed', 2, 'u'),
		]);

		expect(derive([reopened]).sentBackShare).toBe(1);
	});

	it('gives a close to the board it left from, not one it passed through', () => {
		const moved = ticket('t', 'closed', [
			event('add.issue', 'todo', 10, 'u'),
			event('move.node', 'other-lane', 5, 'u'),
			event('close.issue', 'closed', 2, 'u'),
		]);

		expect(derive([moved]).closed).toBe(0);
		expect(
			derive([moved], {lanes: [{id: 'other-lane', title: 'Other'}]}).closed,
		).toBe(1);
	});

	it('takes the middle of an even count, and nothing of none', () => {
		const closedAfter = (id: string, days: number) =>
			ticket(id, 'closed', [
				event('add.issue', 'todo', days + 1, 'u'),
				event('close.issue', 'closed', 1, 'u'),
			]);

		expect(
			derive([closedAfter('a', 2), closedAfter('b', 4)]).medianLeadTimeMs,
		).toBe(3 * DAY);
		expect(derive([]).medianLeadTimeMs).toBeNull();
	});

	it('buckets closes by calendar week, Monday first, the last holding now', () => {
		const {throughput} = derive([]);

		for (const week of throughput) {
			const start = new Date(week.t);
			expect(start.getDay()).toBe(1);
			expect(start.getHours()).toBe(0);
		}
		expect(throughput.at(-1)!.t).toBeLessThanOrEqual(now);
		expect(now - throughput.at(-1)!.t).toBeLessThan(7 * DAY);
	});
});
