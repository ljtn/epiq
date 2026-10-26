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

/** Whether a lane is called Done, which counts as done whatever its rules. */
// By name, not by place: lanes are in whatever order a team put them.
export const isNamedDone = (lane: Swimlane): boolean =>
	lane.title.trim().toLowerCase() === 'done';

/**
 * Whether an open ticket standing in this lane counts as done: the lane has
 * the done rule, or is called Done.
 */
export const isDoneLane = (laneId: string): boolean => {
	const state = getSafeState();
	if (isFail(state)) return false;
	const lane = state.value.nodes[laneId];
	return Boolean(
		lane &&
			isSwimlaneNode(lane) &&
			(laneRules(lane).includes('done') || isNamedDone(lane)),
	);
};
