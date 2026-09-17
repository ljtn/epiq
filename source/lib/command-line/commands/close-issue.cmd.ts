import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {CLOSED_SWIMLANE_ID} from '../../board/static-ids.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {resolveAndPersistRankForMove} from '../../repository/rank.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../event/event.model.js';

export const closeIssueCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const target = getRenderedChildren(contextNode.id)[selectedIndex];

	if (!target) return failed('Unable to close issue, no target found');
	if (!isTicketNode(target)) return failed('Cannot close in this context');

	const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
	if (!closeSwimlane) return failed('Unable to locate closed swimlane');

	if (target.parentNodeId === closeSwimlane.id) {
		return failed('Issue is already closed');
	}

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;
	const persistRoot = persistRootResult.value;

	const rankResult = resolveAndPersistRankForMove(
		closeSwimlane.id,
		target.id,
		{at: 'end'},
		userRes.value,
		persistRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const result = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'close.issue',
				payload: {
					id: target.id,
					parent: closeSwimlane.id,
					rank: rankResult.value,
				},
				...actorOf(userRes.value),
			},
		],
		persistRoot,
	);

	if (isFail(result)) return result;

	return succeeded('Issue closed', null);
};
