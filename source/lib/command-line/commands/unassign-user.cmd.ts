import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {getAssignableContributors} from './assignable-contributors.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../event/event.model.js';

export const unassignUserCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {modifier, inputString} = getCmdState().commandMeta;
	const name = (modifier || inputString).trim();
	if (!name) return failed('Provide an assignee to remove');

	const {selectedNode} = getState();
	if (!selectedNode) return failed('Invalid unassign target');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) {
		return failed('Unable to unassign in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const assignees = ticket.props.assignees ?? [];

	const isSelf = name.toLowerCase() === 'me';

	// Ahead of the lookup, which needs the root for the names only a
	// pre-ZFZFW9D log file name carries.
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	// Resolved against this issue's assignees, not the whole registry, so a
	// shared name is only ambiguous when both people are assigned here.
	const matches = isSelf
		? assignees.filter(id => id === userRes.value.userId)
		: getAssignableContributors(persistRootResult.value)
				.filter(c => c.name === name && assignees.includes(c.id))
				.map(c => c.id);

	if (matches.length > 1) {
		return failed(
			`"${name}" matches ${matches.length} assignees (${matches.join(
				', ',
			)}). Unassign from the GUI to choose by id.`,
		);
	}

	const contributorId = matches[0];

	if (!contributorId) {
		return failed(
			isSelf
				? 'Issue is not assigned to you'
				: `Issue is not assigned to "${name}"`,
		);
	}

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'remove.issue.assignee',
				payload: {
					id: ticket.id,
					assignee: contributorId,
				},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};
