import {LaneVisit} from '../utils/lane-dwell.js';
import {medianOfSorted} from '../utils/number.js';
import {LaneStayPoint} from './swimlane-stats.model.js';

// Whether a lane is getting slower, which none of its current figures can say.
//
// A lane's median stay today is one reading; the same reading taken on each of
// the last thirty days is a slope. Every ticket's visits say exactly which lane
// it was in at any past moment and when it got there, so each day's figure is
// reconstructed rather than remembered — no snapshot has to have been kept.
//
// Driven from the visits rather than from the days: a stay already knows the run
// of days it covers, so each one is counted into the lane it was actually in.
// Asking every lane about every ticket on every day gives the same answer and
// costs the product of all four.

const DAY = 24 * 60 * 60 * 1000;

/**
 * One point per day for each of `laneIds`, oldest first, ending at `now`.
 *
 * `journeys` is every ticket's visits — including tickets that have long since
 * left, since what makes the line move is as much what left the lane as what is
 * standing in it.
 */
export const deriveLaneStayTrends = ({
	laneIds,
	journeys,
	now,
	days,
}: {
	laneIds: readonly string[];
	journeys: ReadonlyArray<readonly LaneVisit[]>;
	now: number;
	days: number;
}): Record<string, LaneStayPoint[]> => {
	const earliest = now - (days - 1) * DAY;

	const ages = new Map<string, number[][]>(
		laneIds.map(laneId => [
			laneId,
			Array.from({length: days}, () => [] as number[]),
		]),
	);

	for (const visits of journeys) {
		for (const [index, visit] of visits.entries()) {
			const lane = ages.get(visit.laneId);
			if (!lane) continue;

			// The sampled days this one stay covers: from the first day at or after
			// it arrived, to the last day before something moved it on.
			const left = visits[index + 1]?.enteredAt;
			const from = Math.max(0, Math.ceil((visit.enteredAt - earliest) / DAY));
			const to =
				left === undefined
					? days - 1
					: Math.min(days - 1, Math.ceil((left - earliest) / DAY) - 1);

			for (let day = from; day <= to; day++) {
				lane[day]!.push(earliest + day * DAY - visit.enteredAt);
			}
		}
	}

	return Object.fromEntries(
		[...ages].map(([laneId, byDay]) => [
			laneId,
			byDay.map((dayAges, day) => ({
				t: earliest + day * DAY,
				median: medianOfSorted(dayAges.sort((a, b) => a - b)),
				count: dayAges.length,
			})),
		]),
	);
};

/** One lane's trend, for the panel that shows only that lane. */
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
	deriveLaneStayTrends({laneIds: [laneId], journeys, now, days})[laneId]!;
