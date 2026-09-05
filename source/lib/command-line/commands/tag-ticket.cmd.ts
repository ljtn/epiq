import {ulid} from 'ulid';
import {nodeRepo, findAncestor} from '../../repository/node-repo.js';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {getPersistRootValue} from './command-utils.js';

export const tagTicketCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {modifier, inputString} = getCmdState().commandMeta;
	const name = (modifier || inputString).trim();
	if (!name) return failed('Provide a tag');

	const {selectedNode} = getState();
	if (!selectedNode) return failed('Invalid tag target');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) {
		return failed('Unable to tag issue in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const persistRootResult = await getPersistRootValue();
	if (isFail(persistRootResult)) return persistRootResult;

	const existingTag = nodeRepo.findTagByName(name);
	const tagId = existingTag?.id ?? ulid();

	const tags = ticket.props.tags ?? [];

	if (tags.includes(tagId)) {
		return failed('Already tagged with that tag');
	}

	return materializeAndPersistAll(
		[
			...(existingTag
				? []
				: [
						{
							id: ulid(),
							action: 'create.tag' as const,
							payload: {
								id: tagId,
								name,
							},
							...userRes.value,
						},
				  ]),
			{
				id: ulid(),
				action: 'add.issue.tag',
				payload: {
					id: ticket.id,
					tag: tagId,
				},
				...userRes.value,
			},
		],
		persistRootResult.value,
	);
};
