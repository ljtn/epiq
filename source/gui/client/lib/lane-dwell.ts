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

// Something happened to a ticket this recently: being worked on now.
const LIVE_WINDOW_MS = 5 * 60 * 1000;
// Quiet for less than this is never stalled, however brisk the lane.
const STALL_FLOOR_MS = DAY;

/** How fresh a ticket is against now. Display only; never used for order. */
export type CardActivity = 'live' | 'stalled' | null;

/**
 * Live: anything happened to it in the last five minutes. Stalled: in a lane
 * between the board's first and last, of at least three tickets, and quiet for
 * longer than that lane's median stay — never under a day.
 */
export const cardActivity = (
	issue: Pick<GuiIssue, 'lastEventAt'>,
	lane: {
		now: number;
		middle: boolean;
		laneMedian: number | null;
		laneSize: number;
	},
): CardActivity => {
	if (issue.lastEventAt === undefined) return null;

	const quiet = lane.now - issue.lastEventAt;
	if (quiet < LIVE_WINDOW_MS) return 'live';
	if (!lane.middle || lane.laneMedian === null) return null;
	if (lane.laneSize < MIN_LANE_SIZE) return null;

	return quiet > Math.max(lane.laneMedian, STALL_FLOOR_MS) ? 'stalled' : null;
};

/** When the first of a lane's live tickets stops being live, or Infinity. */
export const liveExpiry = (
	issues: readonly Pick<GuiIssue, 'lastEventAt'>[],
	now: number,
): number =>
	Math.min(
		...issues.map(issue =>
			issue.lastEventAt !== undefined &&
			now - issue.lastEventAt < LIVE_WINDOW_MS
				? issue.lastEventAt + LIVE_WINDOW_MS
				: Infinity,
		),
	);
