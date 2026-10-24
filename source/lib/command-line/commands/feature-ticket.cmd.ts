import {ulid} from 'ulid';
import {findAncestor} from '../../repository/node-repo.js';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {isTicketNode, Ticket} from '../../model/context.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../event/event.model.js';
import {featureRefusal, findTicket} from '../../utils/feature.utils.js';

const selectedTicket = (): Result<Ticket> => {
	const {selectedNode} = getState();
	if (!selectedNode) return failed('Select an issue first');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) return failed('Not inside an issue');

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	return succeeded('Found issue', ticket);
};

const write = async (ticket: Ticket, feature?: string) => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'set.issue.feature',
				payload: feature ? {id: ticket.id, feature} : {id: ticket.id},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};

/** `:feature <ref>` puts the selected issue in the feature that ref names. */
export const featureTicketCommand = async () => {
	const {modifier, inputString} = getCmdState().commandMeta;
	const ref = (modifier || inputString).trim();
	if (!ref) return failed('Name the feature by its ref');

	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	const feature = findTicket(ref);
	if (!feature) return failed(`No issue ${ref}`);

	const refusal = featureRefusal(ticket, feature);
	if (refusal) return failed(refusal);

	if (ticket.props.feature === feature.id)
		return failed('Already in that feature');

	return write(ticket, feature.id);
};

/** `:unfeature` takes the selected issue out of its feature. */
export const unfeatureTicketCommand = async () => {
	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	if (!ticket.props.feature) return failed('Not in a feature');

	return write(ticket);
};
