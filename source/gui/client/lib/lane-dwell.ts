import {medianOfSorted} from '../../../lib/utils/number.js';
import {GuiIssue} from './gui-state.model';

const DAY = 24 * 60 * 60 * 1000;

// Below three tickets a median is not a baseline, it is a coin toss.
const MIN_LANE_SIZE = 3;

// The multiple is what stops a slow lane flagging everything in it; the floor
// is what stops a fast one flagging a ticket that arrived this morning.
const WARN = {multiple: 3, floor: DAY};
const ALERT = {multiple: 6, floor: 3 * DAY};

export type DwellLevel = 'none' | 'warn' | 'alert';

export type LaneDwell = {median: number; mean: number; max: number};

// A contributor's clock can sit minutes ahead of this one, which would
// otherwise read as a ticket that arrives in its lane in the future.
export const dwellOf = (issue: GuiIssue, now: number): number =>
	Math.max(0, now - issue.enteredLaneAt);

/** How long the lane's open tickets have been sitting in it. */
export const laneDwell = (
	issues: readonly GuiIssue[],
	now: number,
): LaneDwell | null => {
	const dwells = issues
		.filter(issue => !issue.isClosed)
		.map(issue => dwellOf(issue, now))
		.sort((a, b) => a - b);

	if (dwells.length === 0) return null;

	return {
		median: medianOfSorted(dwells) ?? 0,
		mean: dwells.reduce((total, dwell) => total + dwell, 0) / dwells.length,
		max: dwells[dwells.length - 1]!,
	};
};

/** How far out of line one ticket is with the rest of its own lane. */
export const dwellLevel = (
	dwell: number,
	lane: LaneDwell,
	laneSize: number,
): DwellLevel => {
	if (laneSize < MIN_LANE_SIZE) return 'none';

	if (dwell >= Math.max(ALERT.multiple * lane.median, ALERT.floor)) {
		return 'alert';
	}

	if (dwell >= Math.max(WARN.multiple * lane.median, WARN.floor)) return 'warn';

	return 'none';
};
