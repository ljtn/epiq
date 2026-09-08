import {LaneFlow} from './swimlane-stats.model.js';

// What a lane's traffic looks like, from the lane sequences its tickets have
// been through. Sequences in, counts out: the caller derives the journeys from
// whatever copy of the log it holds, so the GUI, the TUI and the MCP can each
// answer this without one of them owning it.

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
 * `journeys` is one lane sequence per ticket, oldest first, over every ticket
 * that has ever been in this lane or anywhere else — a lane's traffic is a
 * question about the tickets that have left it, and those are elsewhere now.
 *
 * A ticket can pass through the same lane more than once; each pass counts,
 * which is what makes a lane that things come back to look different from one
 * they go through once.
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
