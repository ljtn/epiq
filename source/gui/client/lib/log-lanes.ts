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

export type LogLane = {name: string; color: string};

// The actors in the slice, in the order they first appear in it — oldest
// first, since that is the order the log is read in. Off the slice rather
// than off the board's contributors: a lane for somebody who did nothing in
// this window is a column of empty rows.
export const logLanes = (entries: readonly LogEntry[]): LogLane[] => {
	const lanes: LogLane[] = [];
	const seen = new Set<string>();

	for (const entry of entries) {
		if (!entry.actor || seen.has(entry.actor.name)) continue;

		seen.add(entry.actor.name);
		lanes.push({name: entry.actor.name, color: entry.actor.color});
	}

	return lanes;
};

// Which lane each name is, for the rows to read as they are drawn.
export const laneIndexByName = (
	lanes: readonly LogLane[],
): ReadonlyMap<string, number> =>
	new Map(lanes.map((lane, index) => [lane.name, index]));

// The lane a line sits in, or null on a line nobody signed — which spans the
// pane instead, because it belongs to no one column.
export const laneIndexOf = (
	entry: LogEntry,
	indexByName: ReadonlyMap<string, number>,
): number | null =>
	entry.actor ? indexByName.get(entry.actor.name) ?? null : null;

const SPLIT_STORAGE_KEY = 'epiq.eventLog.split';

// Kept per browser, as the field checkboxes beside it are.
export const useLogSplit = (): [boolean, (next: boolean) => void] =>
	usePersistedFlag(SPLIT_STORAGE_KEY, false);
