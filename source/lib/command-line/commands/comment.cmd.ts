import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {BreadCrumb, findInBreadCrumb} from '../../model/app-state.model.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getState} from '../../state/state.js';
import {MAX_COMMENT_LENGTH} from '../../utils/text.limits.js';
import {getPersistRoot} from '../../storage/paths.js';
import {CommandLineInput} from '../../model/action-map.model.js';
import {actorOf} from '../../event/event.model.js';

export const commentCommand = async (cmdState: CommandLineInput) => {
	const md = cmdState.inputString.trim();
	if (!md) return failed('Provide a comment');

	if (md.length > MAX_COMMENT_LENGTH)
		return failed(`Cannot exceed ${MAX_COMMENT_LENGTH} characters`);

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {breadCrumb, selectedNode} = getState();
	const issueResult = findInBreadCrumb(
		[...breadCrumb, selectedNode] as BreadCrumb,
		'TICKET',
	);
	if (isFail(issueResult)) return failed('Edit target must be an issue');

	const target = issueResult.value;
	if (!target) return failed('Invalid comment target');

	const ticketResult =
		target.context === 'TICKET'
			? succeeded('Resolved ticket', target)
			: findAncestor(target.id, 'TICKET');

	if (isFail(ticketResult)) {
		return failed('Unable to comment on issue in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'add.issue.comment',
				payload: {
					id: ulid(),
					issue: ticket.id,
					author: userRes.value.userId,
					md,
				},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};
