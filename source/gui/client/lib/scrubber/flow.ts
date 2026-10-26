// The "Flow" chart: a strand per swimlane, each ticket a line stepping between strands as it moves.

import {GuiEventTimeline, GuiEventTimelineEntry} from '../gui-state.model';
import {BoardView, isShown} from './series';

// A swimlane as the board hands it over: what a strand is made from.
export type FlowLane = {id: string; title: string};

// One horizontal line: board lanes in order, then lanes the board no longer has, then closed.
export type FlowStrand = FlowLane & {
	// The most lines the strand holds at once over the window, which is how
	// many slots its band is fanned into. Zero on a strand nothing sits in.
	slots: number;
};

export const CLOSED_STRAND_ID = 'closed';
const CLOSED_STRAND_TITLE = 'Closed';

// A lane the board no longer has, under the name the log last knew it by,
// where the window's reply carries one.
const removedStrandTitle = (name: string | undefined): string =>
	name === undefined ? '(removed lane)' : `${name} (removed lane)`;

export type FlowVertex = {
	t: number;
	// Index into the chart's strands.
	strand: number;
	// The strand slot the line runs in until its next vertex, so lines stack, not overlap.
	slot: number;
	// The event that put the ticket here, or null at the window's edge.
	eventId: string | null;
};

export type FlowPath = {
	issue: string;
	// The ticket's own colour — its assignee's, where it has one — or null for
	// the series colour. So a board's lines say whose tickets they are.
	color: string | null;
	// In time order. Every vertex after the first is on a different strand from
	// the one before it: a move inside a lane is no step.
	vertices: FlowVertex[];
	// The line ends at a close rather than at the window's edge.
	closed: boolean;
};

export type FlowChart = {strands: FlowStrand[]; paths: FlowPath[]};

const isClosing = (entry: GuiEventTimelineEntry): boolean =>
	entry.action === 'close.issue';

export const buildFlowChart = (
	timeline: GuiEventTimeline | null,
	// The board's lanes, in column order.
	boardLanes: readonly FlowLane[],
	// Every lane the client knows a title for, for one the window names that the
	// board itself does not hold — another board's, under "all boards".
	laneTitles: ReadonlyMap<string, string>,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	keptIssues: ReadonlySet<string> | null = null,
	colorByIssue: ReadonlyMap<string, string> = new Map(),
): FlowChart => {
	const strands: FlowStrand[] = boardLanes.map(lane => ({...lane, slots: 0}));
	const strandIndex = new Map(
		boardLanes.map((lane, index) => [lane.id, index]),
	);

	// The closed lane is a strand of its own, wherever a ticket's events name
	// it; a close is told by its action as well, for the flag on the line.
	const closedLaneId = timeline?.closedLane ?? null;

	const strandOf = (laneId: string): number => {
		if (laneId === closedLaneId) return -1;

		const known = strandIndex.get(laneId);
		if (known !== undefined) return known;

		strands.push({
			id: laneId,
			title:
				laneTitles.get(laneId) ??
				removedStrandTitle(timeline?.laneNames[laneId]),
			slots: 0,
		});
		strandIndex.set(laneId, strands.length - 1);

		return strands.length - 1;
	};

	const closedStrand = (): FlowStrand => ({
		id: CLOSED_STRAND_ID,
		title: CLOSED_STRAND_TITLE,
		slots: 0,
	});

	// A capped window names no events and no tickets — as against a quiet one,
	// which names no events and every ticket that sat still through it.
	const capped = timeline?.events.length === 0 && timeline.buckets.length > 0;

	if (!timeline || capped) {
		return {strands: [...strands, closedStrand()], paths: []};
	}

	// Each ticket's events in time order, open tickets first even without one.
	// Strands come before narrowing, so narrowing never shifts the remaining lines.
	const byIssue = new Map<string, GuiEventTimelineEntry[]>();

	for (const laneId of Object.values(timeline.lanesAtStart)) strandOf(laneId);
	for (const issue of Object.keys(timeline.lanesAtStart))
		byIssue.set(issue, []);

	for (const entry of timeline.events) {
		if (entry.issue === null) continue;

		if (entry.lane !== null && !isClosing(entry)) strandOf(entry.lane);
		if (entry.laneBefore !== null) strandOf(entry.laneBefore);

		const entries = byIssue.get(entry.issue) ?? [];
		entries.push(entry);
		byIssue.set(entry.issue, entries);
	}

	// -1 stands for the closed strand until the strands are all known, since it
	// has to come after every lane the walk turns up.
	const rawPaths: FlowPath[] = [];

	for (const [issue, entries] of byIssue) {
		// A ticket is drawn whole when any of its events passes; one with no events
		// only under the plain view.
		const shown =
			entries.length === 0
				? view === 'all' && (keptIssues === null || keptIssues.has(issue))
				: entries.some(entry => isShown(entry, view, hiddenIds, keptIssues));
		if (!shown) continue;

		const vertices: FlowVertex[] = [];
		let current: number | null = null;
		let closed = false;

		// Open as the window began: the line starts at the edge, on that lane.
		const startLane = timeline.lanesAtStart[issue];

		if (startLane !== undefined) {
			current = strandOf(startLane);
			vertices.push({
				t: timeline.earliest,
				strand: current,
				slot: 0,
				eventId: null,
			});
		}

		for (const entry of entries) {
			if (entry.lane === null) continue;

			const target = isClosing(entry) ? -1 : strandOf(entry.lane);

			if (current === null) {
				if (entry.action === 'add.issue') {
					// Born in the window: the line begins here, not at the edge.
					vertices.push({
						t: entry.t,
						strand: target,
						slot: 0,
						eventId: entry.id,
					});
					current = target;
					continue;
				}

				// Already alive at the window's start, on whatever strand this
				// event found it — the one it left, where it left one.
				const before =
					entry.laneBefore !== null ? strandOf(entry.laneBefore) : target;

				vertices.push({
					t: timeline.earliest,
					strand: before,
					slot: 0,
					eventId: null,
				});
				current = before;
			}

			if (target !== current) {
				vertices.push({t: entry.t, strand: target, slot: 0, eventId: entry.id});
				current = target;
			}

			closed = isClosing(entry) || (closed && target === -1);
		}

		if (current === null) continue;

		if (!closed) {
			vertices.push({
				t: timeline.latest,
				strand: current,
				slot: 0,
				eventId: null,
			});
		}

		rawPaths.push({
			issue,
			color: colorByIssue.get(issue) ?? null,
			vertices,
			closed,
		});
	}

	const closedIndex = strands.length;
	const allStrands = [...strands, closedStrand()];

	const paths = rawPaths.map(path => ({
		...path,
		vertices: path.vertices.map(vertex =>
			vertex.strand === -1 ? {...vertex, strand: closedIndex} : vertex,
		),
	}));

	assignSlots(paths, allStrands);

	return {strands: allStrands, paths};
};

// One stay on a strand: from a vertex until the line's next one. A closed
// line's last vertex is a stay of no length, so the dots share the centre.
type Stay = {start: number; end: number; vertex: FlowVertex};

// Packs each strand's stays into slots by interval colouring, first free slot first.
const assignSlots = (
	paths: readonly FlowPath[],
	strands: FlowStrand[],
): void => {
	const stays: Stay[] = [];
	// A last vertex ends the previous stay rather than starting one, so it can't hop slots.
	const closers: {vertex: FlowVertex; previous: FlowVertex}[] = [];

	for (const path of paths) {
		path.vertices.forEach((vertex, index) => {
			const next = path.vertices[index + 1];
			const previous = path.vertices[index - 1];

			if (next === undefined && previous?.strand === vertex.strand) {
				closers.push({vertex, previous});
				return;
			}

			stays.push({start: vertex.t, end: next?.t ?? vertex.t, vertex});
		});
	}

	// Earlier arrivals first; of two at once, the longer stay takes the lower
	// slot so the band's core is its steadier lines.
	stays.sort((a, b) => a.start - b.start || b.end - a.end);

	const slotEndsByStrand = new Map<number, number[]>();

	for (const stay of stays) {
		const strand = stay.vertex.strand;
		const slotEnds = slotEndsByStrand.get(strand) ?? [];

		let slot = slotEnds.findIndex(end => end <= stay.start);
		if (slot === -1) slot = slotEnds.length;

		slotEnds[slot] = stay.end;
		slotEndsByStrand.set(strand, slotEnds);
		stay.vertex.slot = slot;
	}

	for (const {vertex, previous} of closers) vertex.slot = previous.slot;

	for (const [strand, slotEnds] of slotEndsByStrand) {
		strands[strand]!.slots = slotEnds.length;
	}
};

// The path's last vertex at or before a moment, or null outside the line.
export const flowVertexAt = (path: FlowPath, t: number): FlowVertex | null => {
	const first = path.vertices[0];
	const last = path.vertices[path.vertices.length - 1];
	if (!first || !last || t < first.t || t > last.t) return null;

	let at = first;

	for (const vertex of path.vertices) {
		if (vertex.t > t) break;
		at = vertex;
	}

	return at;
};

export const flowStrandOf = (path: FlowPath, t: number): number | null =>
	flowVertexAt(path, t)?.strand ?? null;

// The nearest path within `tolerance` of the pointer, or null.
export const flowPathAt = (
	paths: readonly FlowPath[],
	t: number,
	y: number,
	lineY: (vertex: FlowVertex) => number,
	tolerance: number,
): FlowPath | null => {
	let best: FlowPath | null = null;
	let bestDistance = tolerance;

	for (const path of paths) {
		const vertex = flowVertexAt(path, t);
		if (vertex === null) continue;

		const distance = Math.abs(lineY(vertex) - y);

		if (distance <= bestDistance) {
			bestDistance = distance;
			best = path;
		}
	}

	return best;
};
