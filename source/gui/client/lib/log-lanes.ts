// Who gets a lane when the log is split by actor, and which lane a line
// belongs in. The panel draws them (see lib/event-log).

import {LogEntry} from './event-log';
import {usePersistedFlag} from './use-persisted-flag';

export type LogLane = {
	name: string;
	// The last lane, standing for everybody the pane had no room for.
	others?: boolean;
};

// Below this, the rest of the actors share the final lane.
export const MIN_LANE_WIDTH_PX = 110;

// An estimate: it only decides how many lanes fit.
const LANE_LEAD_PX = 48;

// How many lanes a pane that wide has room for, at least one.
export const laneCapacity = (paneWidth: number): number =>
	Math.max(1, Math.floor((paneWidth - LANE_LEAD_PX) / MIN_LANE_WIDTH_PX));

// Code-unit order, not the locale's: the lane an actor is in must not depend
// on the machine reading the log.
const byName = (left: {name: string}, right: {name: string}): number =>
	left.name < right.name ? -1 : left.name > right.name ? 1 : 0;

// The slice's actors, ordered by name so lanes never shuffle as the slice
// slides. The busiest keep lanes; the rest share the last.
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

// The actor's lane, the shared last one, or null for an unsigned line, which
// spans the pane.
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
