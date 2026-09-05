import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {resolveReopenParentFromLog} from '../../event/log-utils.js';
import {CLOSED_SWIMLANE_ID} from '../../event/static-ids.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {resolveAndPersistRankForMove} from '../../repository/rank.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRootValue} from './persist-root.js';

export const reopenIssueCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const target = getRenderedChildren(contextNode.id)[selectedIndex];

	if (!target) return failed('Unable to reopen issue, no target found');

	const ticketResult =
		target.context === 'TICKET'
			? succeeded('Resolved ticket', target)
			: findAncestor(target.id, 'TICKET');

	if (isFail(ticketResult)) {
		return failed('Cannot reopen in this context');
	}

	const ticket = ticketResult.value;

	const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
	if (!closeSwimlane) return failed('Unable to locate closed swimlane');

	if (ticket.parentNodeId !== closeSwimlane.id) {
		return failed('Issue is not closed');
	}

	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const previousParentId = resolveReopenParentFromLog(ticket);
	if (!previousParentId) {
		return failed('Unable to resolve previous parent from issue history');
	}

	if (previousParentId === closeSwimlane.id) {
		return failed('Previous parent resolves to closed swimlane');
	}

	const previousParent = getState().nodes[previousParentId];
	if (!previousParent) return failed('Previous parent no longer exists');

	const persistRootResult = await getPersistRootValue();
	if (isFail(persistRootResult)) return persistRootResult;
	const persistRoot = persistRootResult.value;

	const rankResult = resolveAndPersistRankForMove(
		previousParent.id,
		ticket.id,
		{at: 'end'},
		userRes.value,
		persistRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const result = materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'reopen.issue',
				payload: {
					id: ticket.id,
					parent: previousParent.id,
					rank: rankResult.value,
				},
				...userRes.value,
			},
		],
		persistRoot,
	);

	if (isFail(result)) return result;

	return succeeded('Issue reopened', null);
};
