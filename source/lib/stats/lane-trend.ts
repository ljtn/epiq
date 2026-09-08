import {LaneVisit} from '../utils/lane-dwell.js';
import {medianOfSorted} from '../utils/number.js';
import {LaneStayPoint} from './swimlane-stats.model.js';

// Whether a lane is getting slower, which none of its current figures can say.
//
// A lane's median stay today is one reading; the same reading taken on each of
// the last thirty days is a slope. Every ticket's visits say exactly which lane
// it was in at any past moment and when it got there, so each day's figure is
// reconstructed rather than remembered — no snapshot has to have been kept.

const DAY = 24 * 60 * 60 * 1000;

/** How long the ticket had been in `laneId` at `t`, or null if it was elsewhere. */
const ageAt = (
	visits: readonly LaneVisit[],
	laneId: string,
	t: number,
): number | null => {
	for (const [index, visit] of visits.entries()) {
		if (visit.laneId !== laneId || visit.enteredAt > t) continue;

		// Still there at `t` only if nothing moved it away before then.
		const left = visits[index + 1]?.enteredAt;
		if (left === undefined || left > t) return t - visit.enteredAt;
	}

	return null;
};

/**
 * One point per day, oldest first, ending at `now`. `journeys` is every ticket's
 * visits — including tickets that have long since left, since what makes the
 * line move is as much what left the lane as what is standing in it.
 */
export const deriveLaneStayTrend = ({
	laneId,
	journeys,
	now,
	days,
}: {
	laneId: string;
	journeys: ReadonlyArray<readonly LaneVisit[]>;
	now: number;
	days: number;
}): LaneStayPoint[] =>
	Array.from({length: days}, (_, index) => {
		const t = now - (days - 1 - index) * DAY;

		const ages = journeys
			.map(visits => ageAt(visits, laneId, t))
			.filter((age): age is number => age !== null)
			.sort((a, b) => a - b);

		return {t, median: medianOfSorted(ages), count: ages.length};
	});
