import {ulid} from 'ulid';
import {
	materializeAndPersistAll,
	resolveActorId,
} from '../../board/board-log.js';
import {actorOf} from '../../event/event.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {laneRuleChange} from '../../utils/lane-rules.js';
import {laneInScope} from '../command-modifiers.js';

const setRule = async (on: boolean): Promise<Result<unknown>> => {
	const {modifier, inputString} = getCmdState().commandMeta;
	const rule = (modifier || inputString).trim().toLowerCase();

	const lane = laneInScope();
	if (!lane) return failed('Select a swimlane first');

	const change = laneRuleChange(lane, rule, on);
	if (isFail(change) || !change.value) return change;

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const result = materializeAndPersistAll(
		[{id: ulid(), ...change.value, ...actorOf(userRes.value)}],
		persistRootResult.value,
	);
	return isFail(result) ? result : succeeded('Saved', null);
};

/** `:rule <rule>` gives the swimlane in scope a rule. */
export const ruleLaneCommand = () => setRule(true);

/** `:unrule <rule>` takes a rule off the swimlane in scope. */
export const unruleLaneCommand = () => setRule(false);
