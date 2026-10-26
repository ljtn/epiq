// A lane's rules: what standing in it means for its tickets, shared through
// the log so every machine reads a lane alike. A rule this build does not know
// is kept and ignored, so newer ones can be added.

import {Swimlane} from '../model/context.model.js';
import {isSwimlaneNode} from '../model/context.model.js';
import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';

export const LANE_RULES = ['done'] as const;
export type LaneRule = (typeof LANE_RULES)[number];

/** What each rule does, as a lane menu or a command line says it. */
export const LANE_RULE_LABELS: Record<LaneRule, string> = {
	done: 'Marks tickets done',
};

export const isLaneRule = (rule: string): rule is LaneRule =>
	(LANE_RULES as readonly string[]).includes(rule);

/** The rules a lane has that this build knows, as added. */
export const laneRules = (lane: Swimlane): LaneRule[] =>
	(lane.props?.rules ?? []).filter(isLaneRule);

// The lanes whose open tickets count as done, worked out once per state: a
// board's lanes with the done rule, or, on a board with none, a lane called
// Done. Keyed by the state object, which every write replaces.
const doneLanesCache = new WeakMap<object, Set<string>>();

const doneLanes = (): Set<string> => {
	const state = getSafeState();
	if (isFail(state)) return new Set();
	const cached = doneLanesCache.get(state.value);
	if (cached) return cached;

	const byRule = new Map<string, string[]>();
	const byName = new Map<string, string[]>();
	for (const node of Object.values(state.value.nodes)) {
		if (!isSwimlaneNode(node) || node.isDeleted || !node.parentNodeId) continue;
		const board = node.parentNodeId;
		if (laneRules(node).includes('done')) {
			byRule.set(board, [...(byRule.get(board) ?? []), node.id]);
		}
		// By name, not by place: lanes are in whatever order a team put them.
		if (node.title.trim().toLowerCase() === 'done') {
			byName.set(board, [...(byName.get(board) ?? []), node.id]);
		}
	}

	const done = new Set<string>();
	for (const [board, lanes] of byName) {
		if (!byRule.has(board)) lanes.forEach(lane => done.add(lane));
	}
	for (const lanes of byRule.values()) lanes.forEach(lane => done.add(lane));

	doneLanesCache.set(state.value, done);
	return done;
};

/** Whether an open ticket standing in this lane counts as done. */
export const isDoneLane = (laneId: string): boolean => doneLanes().has(laneId);
