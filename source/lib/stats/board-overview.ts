// How a board runs, read off its tickets' own logs: how fast work leaves it,
// how often it goes back, and where its time goes.
//
// Pure: the caller hands over the tickets, so the answer is a function of the
// state it was asked about.

import {AppEvent} from '../board/board-events.model.js';
import {clampUlidTime, getEventTime} from '../event/date-utils.js';
import {laneVisits} from '../utils/lane-dwell.js';
import {medianOfSorted} from '../utils/number.js';
import {BoardOverview} from './board-overview.model.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export const THROUGHPUT_WEEKS = 8;

export type OverviewTicket = {
	id: string;
	parentNodeId: string | null;
	log: readonly AppEvent[];
	createdAt: number;
};

const median = (values: number[]): number | null =>
	medianOfSorted([...values].sort((a, b) => a - b));

export const deriveBoardOverview = ({
	boardId,
	lanes,
	tickets,
	now,
}: {
	boardId: string;
	// In board order.
	lanes: ReadonlyArray<{id: string; title: string}>;
	// Every ticket on the workspace: a closed ticket has left the board's
	// lanes, and is the board's by where it was before.
	tickets: readonly OverviewTicket[];
	now: number;
}): BoardOverview => {
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const onBoard = (laneId: string | null | undefined) =>
		laneId !== null && laneId !== undefined && laneIndex.has(laneId);

	const journeys = tickets.map(ticket => ({
		ticket,
		visits: laneVisits(ticket.log, ticket.createdAt),
	}));
	const ours = journeys.filter(({visits}) =>
		visits.some(visit => onBoard(visit.laneId)),
	);

	const timeOf = (event: AppEvent) => {
		const t = getEventTime(event);
		return t === null ? null : clampUlidTime(t, now);
	};

	// A move to a lane earlier in the board's order than the one it left.
	const wentBack = (visits: ReturnType<typeof laneVisits>) =>
		visits.some((visit, index) => {
			const from = laneIndex.get(visits[index - 1]?.laneId ?? '');
			const to = laneIndex.get(visit.laneId);
			return from !== undefined && to !== undefined && to < from;
		});

	// The ticket's last close, counted only when it left from this board.
	const closes = ours.flatMap(({ticket, visits}) => {
		const last = ticket.log.findLast(event => event.action === 'close.issue');
		if (!last || onBoard(ticket.parentNodeId)) return [];

		const closedAt = timeOf(last);
		const before = visits.at(-2)?.laneId;
		if (closedAt === null || !onBoard(before)) return [];

		// Each stay on this board, up to the close.
		const stays = visits.slice(0, -1).flatMap((visit, index) =>
			onBoard(visit.laneId)
				? [
						{
							laneId: visit.laneId,
							ms: visits[index + 1]!.enteredAt - visit.enteredAt,
						},
				  ]
				: [],
		);

		return [
			{
				closedAt,
				leadTime: closedAt - ticket.createdAt,
				sentBack: wentBack(visits),
				stays,
			},
		];
	});

	const weeksStart = now - THROUGHPUT_WEEKS * WEEK;
	const recentCloses = closes.filter(close => close.closedAt >= weeksStart);
	const throughput = Array.from({length: THROUGHPUT_WEEKS}, (_, index) => {
		const t = weeksStart + index * WEEK;

		return {
			t,
			closed: closes.filter(
				close => close.closedAt >= t && close.closedAt < t + WEEK,
			).length,
		};
	});

	const spent = new Map<string, number>();
	for (const {stays} of recentCloses) {
		for (const {laneId, ms} of stays) {
			spent.set(laneId, (spent.get(laneId) ?? 0) + ms);
		}
	}
	const totalSpent = [...spent.values()].reduce((sum, ms) => sum + ms, 0);
	const laneTime = lanes.flatMap(lane => {
		const ms = spent.get(lane.id) ?? 0;

		return ms <= 0
			? []
			: [
					{
						laneId: lane.id,
						title: lane.title,
						meanMs: ms / recentCloses.length,
						share: ms / totalSpent,
					},
			  ];
	});

	return {
		boardId,
		throughput,
		filed: ours.filter(
			({ticket, visits}) =>
				ticket.createdAt >= weeksStart && onBoard(visits[0]?.laneId),
		).length,
		closed: recentCloses.length,
		medianLeadTimeMs: median(recentCloses.map(close => close.leadTime)),
		sentBackShare:
			recentCloses.length === 0
				? null
				: recentCloses.filter(close => close.sentBack).length /
				  recentCloses.length,
		laneTime,
	};
};
