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

export const THROUGHPUT_WEEKS = 8;

// Calendar weeks, Monday first, the last one holding now: what "week of"
// means to a reader. Stepped by date rather than by 7×24h, which a daylight
// saving change would knock off midnight.
const weekStarts = (now: number, count: number): number[] => {
	const monday = new Date(now);
	monday.setHours(0, 0, 0, 0);
	monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

	return Array.from({length: count}, (_, index) => {
		const start = new Date(monday);
		start.setDate(monday.getDate() - 7 * (count - 1 - index));
		return start.getTime();
	});
};

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
	formerLaneIds = [],
	tickets,
	now,
}: {
	boardId: string;
	// In board order: the lanes the figures are shown for, and the order that
	// says what "back" is.
	lanes: ReadonlyArray<{id: string; title: string}>;
	// Lanes the board has had and deleted. Work that passed through them is
	// still the board's, or deleting a lane would rewrite its history.
	formerLaneIds?: readonly string[];
	// Every ticket on the workspace: a closed ticket has left the board's
	// lanes, and is the board's by where it was before.
	tickets: readonly OverviewTicket[];
	now: number;
}): BoardOverview => {
	const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
	const former = new Set(formerLaneIds);
	const onBoard = (laneId: string | null | undefined) =>
		laneId !== null &&
		laneId !== undefined &&
		(laneIndex.has(laneId) || former.has(laneId));

	const journeys = tickets.map(ticket => ({
		ticket,
		visits: laneVisits(ticket.log, ticket.createdAt),
	}));
	const ours = journeys.filter(({visits}) =>
		visits.some(visit => onBoard(visit.laneId)),
	);

	// Never past now: a peer's clock running ahead would otherwise put a close
	// in no week at all.
	const timeOf = (event: AppEvent) => {
		const t = getEventTime(event);
		return t === null ? null : Math.min(clampUlidTime(t, now), now);
	};

	// A step to a lane earlier in the board's current order than the last of
	// its lanes the ticket stood in, whatever it passed through between: a
	// reopen into Todo after closing from Review went back.
	const wentBack = (visits: ReturnType<typeof laneVisits>) => {
		const positions = visits.flatMap(visit => {
			const index = laneIndex.get(visit.laneId);
			return index === undefined ? [] : [index];
		});

		return positions.some(
			(position, index) => index > 0 && position < positions[index - 1]!,
		);
	};

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

	const starts = weekStarts(now, THROUGHPUT_WEEKS);
	const weeksStart = starts[0]!;
	const recentCloses = closes.filter(close => close.closedAt >= weeksStart);
	const throughput = starts.map((t, index) => {
		const end = starts[index + 1] ?? Infinity;

		return {
			t,
			closed: recentCloses.filter(
				close => close.closedAt >= t && close.closedAt < end,
			).length,
		};
	});

	const spent = new Map<string, number>();
	for (const {stays} of recentCloses) {
		for (const {laneId, ms} of stays) {
			spent.set(laneId, (spent.get(laneId) ?? 0) + ms);
		}
	}
	const totalSpent = lanes.reduce(
		(sum, lane) => sum + (spent.get(lane.id) ?? 0),
		0,
	);
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
