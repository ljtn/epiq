import {ulid} from 'ulid';
import {nodeRepo, findAncestor} from '../../repository/node-repo.js';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {getPersistRootValue} from './command-utils.js';

export const untagTicketCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {modifier, inputString} = getCmdState().commandMeta;
	const name = (modifier || inputString).trim();
	if (!name) return failed('Provide a tag');

	const existingTag = nodeRepo.findTagByName(name);
	if (!existingTag) return failed(`Tag "${name}" does not exist`);

	const {selectedNode} = getState();
	if (!selectedNode) return failed('Invalid untag target');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) {
		return failed('Unable to untag issue in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const tags = ticket.props.tags ?? [];

	if (!tags.includes(existingTag.id)) {
		return failed('Issue is not tagged with that tag');
	}

	const persistRootResult = await getPersistRootValue();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'remove.issue.tag',
				payload: {
					id: ticket.id,
					tag: existingTag.id,
				},
				...userRes.value,
			},
		],
		persistRootResult.value,
	);
};
