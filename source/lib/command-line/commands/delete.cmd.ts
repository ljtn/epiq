import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {AppEvent} from '../../event/event.model.js';
import {getPersistRootValue} from './persist-root.js';

const isAddIssueCommentEvent = (
	event: AppEvent,
): event is AppEvent & {
	action: 'add.issue.comment';
	payload: {
		id: string;
		issue: string;
		author: string;
		md: string;
	};
} => event.action === 'add.issue.comment';

export const deleteCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const child = getRenderedChildren(contextNode.id)[selectedIndex];
	if (!child) return failed('Unable to resolve child to delete');

	const persistRootResult = await getPersistRootValue();
	if (isFail(persistRootResult)) return persistRootResult;

	if (child.context === 'COMMENT') {
		const commentId = child.id;

		const issueId = isTicketNode(contextNode)
			? contextNode.id
			: contextNode.parentNodeId;

		if (!issueId) return failed('Unable to resolve comment issue');

		const ticket = getState().nodes[issueId];

		if (!ticket || !isTicketNode(ticket)) {
			return failed('Unable to resolve comment issue');
		}

		const commentEvent = ticket.log
			?.filter(isAddIssueCommentEvent)
			.find(event => event.payload.id === commentId);

		if (!commentEvent) return failed('Unable to resolve comment');

		if (commentEvent.payload.author !== userRes.value.userId) {
			return failed('You can only delete your own comments');
		}

		return materializeAndPersistAll(
			[
				{
					id: ulid(),
					action: 'delete.issue.comment',
					payload: {
						id: commentId,
						issue: issueId,
					},
					...userRes.value,
				},
			],
			persistRootResult.value,
		);
	}

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'delete.node',
				payload: {
					id: child.id,
				},
				...userRes.value,
			},
		],
		persistRootResult.value,
	);
};
