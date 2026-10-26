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
import {AppEvent} from '../../board/board-events.model.js';
import {
	findGoal,
	goalNameRefusal,
	ticketBoardId,
} from '../../utils/goal.utils.js';
import {sanitizeInlineText} from '../../utils/string.utils.js';

const selectedTicket = (): Result<Ticket> => {
	const {selectedNode} = getState();
	if (!selectedNode) return failed('Select an issue first');

	const ticketResult = findAncestor(selectedNode.id, 'TICKET');
	if (isFail(ticketResult)) return failed('Not inside an issue');

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	return succeeded('Found issue', ticket);
};

const write = async (events: AppEvent[]) => {
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersistAll(events, persistRootResult.value);
};

type Actor = Parameters<typeof actorOf>[0];

const setGoalEvent = (
	actorId: Actor,
	ticket: Ticket,
	goal?: string,
): AppEvent => ({
	id: ulid(),
	action: 'set.issue.goal',
	payload: goal ? {id: ticket.id, goal} : {id: ticket.id},
	...actorOf(actorId),
});

/**
 * `:goal <name>` puts the selected issue in its board's goal of that name,
 * making the goal first when there is none.
 */
export const goalTicketCommand = async () => {
	const {modifier, inputString} = getCmdState().commandMeta;
	const name = sanitizeInlineText(modifier || inputString).trim();
	if (!name) return failed('Name the goal');

	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	const boardId = ticketBoardId(ticket);
	if (!boardId) return failed('The issue is on no board');

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');
	const actorId: Actor = userRes.value;

	const goal = findGoal(boardId, name);
	if (goal) {
		if (ticket.props.goal === goal.id) return failed('Already in that goal');
		return write([setGoalEvent(actorId, ticket, goal.id)]);
	}

	const refusal = goalNameRefusal(boardId, name);
	if (refusal) return failed(refusal);

	const goalId = ulid();
	return write([
		{
			id: goalId,
			action: 'create.goal',
			payload: {id: goalId, name, board: boardId},
			...actorOf(actorId),
		},
		setGoalEvent(actorId, ticket, goalId),
	]);
};

/** `:ungoal` takes the selected issue out of its goal. */
export const ungoalTicketCommand = async () => {
	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	if (!ticket.props.goal) return failed('Not in a goal');

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	return write([setGoalEvent(userRes.value, ticket)]);
};
