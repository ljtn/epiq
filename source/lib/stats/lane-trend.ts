import {LaneVisit} from '../utils/lane-dwell.js';
import {medianOfSorted} from '../utils/number.js';
import {LaneStayPoint} from './swimlane-stats.model.js';

// Each lane's daily median stay over recent days, rebuilt from ticket visits.
// Driven per visit, not per lane per day.

const DAY = 24 * 60 * 60 * 1000;

/**
 * One point per day per lane, oldest first, ending at `now`. `journeys`
 * includes tickets that have since left.
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
