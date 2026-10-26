import {ulid} from 'ulid';
import {findAncestor} from '../../repository/node-repo.js';
import {
	materializeAndPersistAll,
	resolveActorId,
} from '../../board/board-log.js';
import {isTicketNode, Ticket} from '../../model/context.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../event/event.model.js';
import {AppEvent} from '../../board/board-events.model.js';
import {
	findGoal,
	getTicketGoal,
	goalName,
	goalNameRefusal,
	oneGoalChanges,
} from '../../utils/goal.utils.js';

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

const oneGoalEvents = (
	actor: Actor,
	ticket: Ticket,
	goal?: string,
): AppEvent[] =>
	oneGoalChanges(ticket, goal).map(change => ({
		id: ulid(),
		...change,
		...actorOf(actor),
	}));

/**
 * `:goal <name>` puts the selected issue in the goal of that name, making the
 * goal first when there is none.
 */
export const goalTicketCommand = async () => {
	const {modifier, inputString} = getCmdState().commandMeta;
	const name = goalName(modifier || inputString);
	if (!name) return failed('Name the goal');

	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');
	const actor: Actor = userRes.value;

	const goal = findGoal(name);
	if (goal) {
		const events = oneGoalEvents(actor, ticket, goal.id);
		if (events.length === 0) return failed('Already in that goal');
		return write(events);
	}

	const refusal = goalNameRefusal(name);
	if (refusal) return failed(refusal);

	const goalId = ulid();
	return write([
		{
			id: goalId,
			action: 'create.goal',
			payload: {id: goalId, name},
			...actorOf(actor),
		},
		...oneGoalEvents(actor, ticket, goalId),
	]);
};

/** `:ungoal` takes the selected issue out of its goal. */
export const ungoalTicketCommand = async () => {
	const ticketResult = selectedTicket();
	if (isFail(ticketResult)) return ticketResult;
	const ticket = ticketResult.value;

	if (!getTicketGoal(ticket)) return failed('Not in a goal');

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	return write(oneGoalEvents(userRes.value, ticket));
};
