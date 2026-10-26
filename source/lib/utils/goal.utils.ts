// A goal is a name in the project that tickets belong to, one goal per ticket,
// on whichever board they stand; how far along it is comes from those tickets,
// never from the goal itself. Tags stay the way to say several things. This
// module answers it for every door: the API, the GUI behind it, and the TUI.

import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from '../board/static-ids.js';
import {Goal} from '../model/app-state.model.js';
import {isTicketNode, Ticket} from '../model/context.model.js';
import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';
import {getMutedStringColor} from './color.js';
import {sanitizeInlineText} from './string.utils.js';
import {boardsEverOnOf} from './ticket-boards.js';

// No state, or one with no nodes yet, still answers: there are no goals.
const stateOrNone = () => {
	const state = getSafeState();
	return isFail(state) ? null : state.value;
};
const nodesOrNone = () => stateOrNone()?.nodes ?? {};
const goalsOrNone = () => stateOrNone()?.goals ?? {};

/** A goal that has not been removed. */
export const getGoal = (id: string): Goal | undefined => {
	const goal = goalsOrNone()[id];
	return goal?.tombstoned ? undefined : goal;
};

/** The project's goals, oldest first. */
export const projectGoals = (): Goal[] =>
	Object.values(goalsOrNone())
		.filter(goal => !goal.tombstoned)
		.sort((a, b) => a.id.localeCompare(b.id));

/** A goal's name as stored, so a lookup and a write compare alike. */
export const goalName = (name: string): string =>
	sanitizeInlineText(name).trim();

/** A goal by id, or by name in any case. */
export const findGoal = (idOrName: string): Goal | undefined => {
	const wanted = goalName(idOrName);
	if (!wanted) return undefined;

	const byId = getGoal(wanted);
	if (byId) return byId;

	// The oldest of a name, should two machines have made one each.
	const name = wanted.toLowerCase();
	return projectGoals().find(goal => goal.name.toLowerCase() === name);
};

/** The goal a ticket belongs to, while it has not been removed. */
export const getTicketGoal = (ticket: Ticket): Goal | undefined =>
	ticket.props?.goal ? getGoal(ticket.props.goal) : undefined;

/** Muted, and from the id, so renaming a goal keeps its colour. */
export const goalColor = (goal: Goal): string => getMutedStringColor(goal.id);

/** The board a ticket stands on: its lane's parent. */
const ticketBoardId = (ticket: Ticket): string | undefined => {
	const lane = ticket.parentNodeId
		? nodesOrNone()[ticket.parentNodeId]
		: undefined;
	return lane?.parentNodeId ?? undefined;
};

/**
 * The boards a ticket shows its goal on: the one it stands on, or, once
 * closed, every one it stood on, so a finished goal stays where it was worked.
 */
const ticketBoards = (ticket: Ticket): string[] => {
	if (ticket.parentNodeId === CLOSED_SWIMLANE_ID) return boardsEverOnOf(ticket);
	const board = ticketBoardId(ticket);
	return board ? [board] : [];
};

// Who belongs to which goal, worked out once per state: a terminal row asks
// for every ticket on screen, on every key press. Keyed by the state object,
// which every write replaces, batched ones included; the nodes map is not, as
// a batch writes into it in place.
const membersCache = new WeakMap<object, Map<string, Ticket[]>>();

const membersByGoal = (): Map<string, Ticket[]> => {
	const state = stateOrNone();
	if (!state) return new Map();
	const cached = membersCache.get(state);
	if (cached) return cached;

	const members = new Map<string, Ticket[]>();
	for (const node of Object.values(nodesOrNone())) {
		if (!isTicketNode(node) || node.isDeleted) continue;
		const goal = getTicketGoal(node)?.id;
		if (goal) members.set(goal, [...(members.get(goal) ?? []), node]);
	}

	membersCache.set(state, members);
	return members;
};

export const goalMembers = (goalId: string): Ticket[] =>
	membersByGoal().get(goalId) ?? [];

/** How many of a goal's tickets a board shows. */
export const goalMembersOn = (goalId: string, boardId: string): number =>
	goalMembers(goalId).filter(ticket => ticketBoards(ticket).includes(boardId))
		.length;

/**
 * The goals a board shows: those with a ticket on it, and those with none
 * anywhere yet, so a new goal is seen where it can be joined.
 */
export const boardGoals = (boardId: string): Goal[] =>
	projectGoals().filter(goal =>
		goalMembers(goal.id).length === 0
			? boardId !== CLOSED_BOARD_ID
			: goalMembersOn(goal.id, boardId) > 0,
	);

/**
 * How far along a goal is, over every ticket in it on every board, however
 * long ago it was closed: done is closed, or standing in a lane called Done.
 */
export const goalProgress = (goalId: string): {done: number; total: number} => {
	const members = goalMembers(goalId);

	// By name, not by place: lanes are in whatever order a team put them.
	const isDone = (ticket: Ticket) =>
		ticket.parentNodeId === CLOSED_SWIMLANE_ID ||
		nodesOrNone()[ticket.parentNodeId ?? '']?.title.trim().toLowerCase() ===
			'done';

	return {done: members.filter(isDone).length, total: members.length};
};

/** Why a goal may not be named so, or null when it may. */
export const goalNameRefusal = (
	name: string,
	exceptId?: string,
): string | null => {
	if (!goalName(name)) return 'A goal needs a name';

	const taken = findGoal(name);
	return taken && taken.id !== exceptId
		? `There is already a goal called "${taken.name}"`
		: null;
};

/**
 * What a terminal row says of a ticket's goal. `width` bounds the text; 0
 * asks only whether there is a mark and its colour.
 */
export const goalMark = (
	ticket: Ticket,
	width: number,
): {text: string; color: string} | null => {
	const goal = getTicketGoal(ticket);
	if (!goal) return null;

	const text = `◆ ${sanitizeInlineText(goal.name)}`;
	return {
		text:
			text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text,
		color: goalColor(goal),
	};
};
