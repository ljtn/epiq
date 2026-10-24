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
import {goalRefusal, findTicket} from '../../utils/goal.utils.js';

const selectedTicket = (): Result<Ticket> => {
	const {selectedNode} = getState();
	if (!selectedNode) return failed('Select an issue first');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) return failed('Not inside an issue');

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	return succeeded('Found issue', ticket);
};

const write = async (ticket: Ticket, goal?: string) => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'set.issue.goal',
				payload: goal ? {id: ticket.id, goal} : {id: ticket.id},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};

/** `:goal <ref>` puts the selected issue in the goal that ref names. */
export const goalTicketCommand = async () => {
	const {modifier, inputString} = getCmdState().commandMeta;
	const ref = (modifier || inputString).trim();
	if (!ref) return failed('Name the goal by its ref');

	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	const goal = findTicket(ref);
	if (!goal) return failed(`No issue ${ref}`);

	const refusal = goalRefusal(ticket, goal);
	if (refusal) return failed(refusal);

	if (ticket.props.goal === goal.id) return failed('Already in that goal');

	return write(ticket, goal.id);
};

/** `:ungoal` takes the selected issue out of its goal. */
export const ungoalTicketCommand = async () => {
	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	if (!ticket.props.goal) return failed('Not in a goal');

	return write(ticket);
};
