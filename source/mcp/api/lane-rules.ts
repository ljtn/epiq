// A lane's rules, set one at a time by name.

import {ulid} from 'ulid';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {Swimlane} from '../../lib/model/context.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {isLaneRule, LaneRule, laneRules} from '../../lib/utils/lane-rules.js';
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

	if (!isLaneRule(input.rule)) return failed(`No lane rule "${input.rule}"`);

	const laneResult = findWritableSwimlane(input.swimlaneId);
	if (isFail(laneResult)) return laneResult;
	const lane = laneResult.value;

	const saved = {id: lane.id, ref: nodeRef(lane.id), rule: input.rule};
	const has = (lane.props.rules ?? []).includes(input.rule);
	if (has === input.on) return succeeded('No changes made', saved);

	const event: AppEvent = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: input.on ? 'add.swimlane.rule' : 'remove.swimlane.rule',
		payload: {id: lane.id, rule: input.rule},
	};

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded(input.on ? 'Added lane rule' : 'Removed lane rule', saved);
};
