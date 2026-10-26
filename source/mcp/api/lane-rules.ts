// A lane's rules, set one at a time by name.

import {ulid} from 'ulid';
import {actorOf} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Swimlane} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {LaneRule} from '../../lib/model/lane-rule.model.js';
import {laneRuleChange, laneRules} from '../../lib/utils/lane-rules.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {bootedWithActorAndState, ToolInput} from './boot.js';
import {findWritableSwimlane} from './node-targets.js';

/** What a lane carries about its rules, for every projection of it. */
export const rulesOf = (lane: Swimlane): {rules?: LaneRule[]} => {
	const rules = laneRules(lane);
	return rules.length > 0 ? {rules} : {};
};

/** Turns one of a lane's rules on or off. */
export const setSwimlaneRule = async (
	input: ToolInput & {swimlaneId: string; rule: string; on: boolean},
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const laneResult = findWritableSwimlane(input.swimlaneId);
	if (isFail(laneResult)) return laneResult;
	const lane = laneResult.value;

	const change = laneRuleChange(lane, input.rule, input.on);
	if (isFail(change)) return change;

	const saved = {id: lane.id, ref: nodeRef(lane.id), rule: input.rule};
	if (!change.value) return succeeded(change.message, saved);

	const results = materializeAndPersistAll(
		[{id: ulid(), ...actorOf(ready.value.actor), ...change.value}],
		ready.value.boot.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded(input.on ? 'Added lane rule' : 'Removed lane rule', saved);
};
