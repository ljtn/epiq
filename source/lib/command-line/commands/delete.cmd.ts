import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../board/board-events.model.js';

export const deleteCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const child = getRenderedChildren(contextNode.id)[selectedIndex];
	if (!child) return failed('Unable to resolve child to delete');

	const persistRootResult = await getPersistRoot();
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

		const comment = nodeRepo.getComment(commentId);
		if (!comment || comment.issue !== ticket.id) {
			return failed('Unable to resolve comment');
		}

		if (comment.authorId !== userRes.value.userId) {
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
					...actorOf(userRes.value),
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
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};
