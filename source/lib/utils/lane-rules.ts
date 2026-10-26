// A lane's rules, shared through the log so every machine reads a lane alike.
// A rule this build does not know is kept and ignored, so newer ones can be
// added.

import {AppEvent} from '../board/board-events.model.js';
import {isSwimlaneNode, Swimlane} from '../model/context.model.js';
import {isLaneRule, LANE_RULES, LaneRule} from '../model/lane-rule.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';

/** The rules a lane lacks, which `:rule` offers. */
export const rulesLacking = (lane: Swimlane): LaneRule[] =>
	LANE_RULES.filter(rule => !laneRules(lane).includes(rule));

/** The rules a lane has that this build knows, as added. */
export const laneRules = (lane: Swimlane): LaneRule[] =>
	(lane.props?.rules ?? []).filter(isLaneRule);

/**
 * The event that turns a lane's rule on or off, null when it already is so,
 * or why it may not. Every door asks here, so each answers alike.
 */
export const laneRuleChange = (
	lane: Swimlane,
	rule: string,
	on: boolean,
): Result<Pick<
	AppEvent<'add.swimlane.rule' | 'remove.swimlane.rule'>,
	'action' | 'payload'
> | null> => {
	if (!isLaneRule(rule)) return failed(`No lane rule "${rule}"`);
	if (lane.readonly) return failed('Swimlane is readonly');
	if ((lane.props.rules ?? []).includes(rule) === on) {
		return succeeded('No changes made', null);
	}

	return succeeded('Rule changed', {
		action: on ? 'add.swimlane.rule' : 'remove.swimlane.rule',
		payload: {id: lane.id, rule},
	});
};

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
