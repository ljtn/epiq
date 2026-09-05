import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {
	getAssignableContributors,
	getPersistRootValue,
} from './command-utils.js';

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

	// Resolved against this issue's assignees, not the whole registry, so a
	// shared name is only ambiguous when both people are assigned here.
	const matches = isSelf
		? assignees.filter(id => id === userRes.value.userId)
		: getAssignableContributors()
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

	const persistRootResult = await getPersistRootValue();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'remove.issue.assignee',
				payload: {
					id: ticket.id,
					assignee: contributorId,
				},
				...userRes.value,
			},
		],
		persistRootResult.value,
	);
};
