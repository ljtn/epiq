// Who gets a lane when the log is split, and which lane a line belongs in.
// The panel draws the lanes — see the split rules in lib/event-log — this says
// what there is to draw.
//
// Split, the log stops being one interleaved list and becomes a lane per
// actor: time still runs down the pane and every line keeps its place in it,
// but a line is indented into its own actor's lane, so two agents working at
// once read as two streams rather than as one column nobody can untangle.

import {LogEntry} from './event-log';
import {usePersistedFlag} from './use-persisted-flag';

export type LogLane = {
	name: string;
	// The last lane, standing for everybody the pane had no room for.
	others?: boolean;
};

// Narrower than this and a lane holds no readable words, so lanes stop being
// added and the rest of the actors share the final one instead. The panel is
// dragged to width, so a reader who wants them all can have them.
export const MIN_LANE_WIDTH_PX = 110;

// What the clock column and the dot's gap take before the first lane starts.
// An estimate, deliberately: it only decides how many lanes fit, and the exact
// figure is a `ch` the stylesheet resolves.
const LANE_LEAD_PX = 48;

// How many lanes a pane that wide has room for, at least one.
export const laneCapacity = (paneWidth: number): number =>
	Math.max(1, Math.floor((paneWidth - LANE_LEAD_PX) / MIN_LANE_WIDTH_PX));

// Code-unit order, not the locale's: the lane an actor is in must not depend
// on the machine reading the log.
const byName = (left: {name: string}, right: {name: string}): number =>
	left.name < right.name ? -1 : left.name > right.name ? 1 : 0;

// The actors in the slice, by name rather than by when they first appear: the
// slice slides as lines arrive, and a lane order that follows first appearance
// would shuffle the whole pane sideways when the oldest line drops off the top.
//
// Off the slice rather than off the board's contributors: a lane for somebody
// who did nothing in this window is a column of empty rows. Where there are
// more actors than the pane has room for, the busiest keep their lanes and the
// rest share the last one.
export const logLanes = (
	entries: readonly LogEntry[],
	capacity = Number.POSITIVE_INFINITY,
): LogLane[] => {
	const counted = new Map<string, {name: string; lines: number}>();

	for (const entry of entries) {
		if (!entry.actor) continue;

		const seen = counted.get(entry.actor.name);

		if (seen) seen.lines++;
		else {
			counted.set(entry.actor.name, {name: entry.actor.name, lines: 1});
		}
	}

	const actors = [...counted.values()];
	const lane = ({name}: {name: string}): LogLane => ({name});

	if (actors.length <= capacity) return actors.sort(byName).map(lane);

	// Busiest first to decide who is kept, then back into name order to decide
	// where they sit.
	const kept = actors
		.sort((left, right) => right.lines - left.lines || byName(left, right))
		.slice(0, Math.max(1, capacity - 1))
		.sort(byName);

	return [
		...kept.map(lane),
		{name: `+${actors.length - kept.length} more`, others: true},
	];
};

// Which lane each name is, for the rows to read as they are drawn.
export const laneIndexByName = (
	lanes: readonly LogLane[],
): ReadonlyMap<string, number> =>
	new Map(lanes.map((lane, index) => [lane.name, index]));

// The lane a line sits in: its actor's, the shared last one where that actor
// has none, or null on a line nobody signed — which spans the pane instead,
// because it belongs to no one column.
export const laneIndexOf = (
	entry: LogEntry,
	lanes: readonly LogLane[],
	indexByName: ReadonlyMap<string, number>,
): number | null => {
	if (!entry.actor) return null;

	const own = indexByName.get(entry.actor.name);
	if (own !== undefined) return own;

	const others = lanes.length - 1;

	return lanes[others]?.others ? others : null;
};

const SPLIT_STORAGE_KEY = 'epiq.eventLog.split';

// Kept per browser, as the field checkboxes beside it are.
export const useLogSplit = (): [boolean, (next: boolean) => void] =>
	usePersistedFlag(SPLIT_STORAGE_KEY, false);
