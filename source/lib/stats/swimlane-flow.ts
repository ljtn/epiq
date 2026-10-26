import {LaneFlow} from './swimlane-stats.model.js';

// A lane's traffic, from the lane sequences its tickets have been through.

// A ticket filed straight into the lane arrived from nowhere, which is a
// different fact from arriving from a lane and worth its own row.
const FILED_HERE = 'Filed here';

const bump = (counts: Map<string | null, number>, key: string | null) =>
	counts.set(key, (counts.get(key) ?? 0) + 1);

const ranked = (
	counts: Map<string | null, number>,
	total: number,
	titleOf: (laneId: string) => string,
): LaneFlow[] =>
	[...counts.entries()]
		.map(([laneId, count]) => ({
			laneId,
			title: laneId === null ? FILED_HERE : titleOf(laneId),
			count,
			share: total === 0 ? 0 : count / total,
		}))
		.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

/**
 * `journeys`: one lane sequence per ticket, oldest first, over every ticket.
 * Each pass through the lane counts.
 */
export const deriveLaneFlow = (
	swimlaneId: string,
	journeys: ReadonlyArray<readonly string[]>,
	titleOf: (laneId: string) => string,
): {
	arrived: number;
	departed: number;
	arrivesFrom: LaneFlow[];
	movesOnTo: LaneFlow[];
} => {
	const from = new Map<string | null, number>();
	const to = new Map<string | null, number>();

	let arrived = 0;
	let departed = 0;

	for (const journey of journeys) {
		for (const [index, laneId] of journey.entries()) {
			if (laneId !== swimlaneId) continue;

			arrived++;
			bump(from, journey[index - 1] ?? null);

			// Still sitting in the lane: an arrival with no departure yet, and
			// counting it as one would read as tickets that never leave.
			const next = journey[index + 1];
			if (next === undefined) continue;

			departed++;
			bump(to, next);
		}
	}

	return {
		arrived,
		departed,
		arrivesFrom: ranked(from, arrived, titleOf),
		movesOnTo: ranked(to, departed, titleOf),
	};
};
