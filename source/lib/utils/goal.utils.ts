// A goal is a name on a board that tickets belong to, one goal per ticket;
// how far along it is comes from those tickets, never from the goal itself.
// Tags stay the way to say several things. This module answers it for every
// door: the API, the GUI behind it, and the TUI.

import {CLOSED_SWIMLANE_ID} from '../board/static-ids.js';
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

/** A board's goals, oldest first. */
export const boardGoals = (boardId: string): Goal[] =>
	Object.values(goalsOrNone())
		.filter(goal => goal.board === boardId && !goal.tombstoned)
		.sort((a, b) => a.id.localeCompare(b.id));

/** A goal's name as stored, so a lookup and a write compare alike. */
export const goalName = (name: string): string =>
	sanitizeInlineText(name).trim();

/** One of a board's goals, by id or by name in any case. */
export const findGoal = (
	boardId: string,
	idOrName: string,
): Goal | undefined => {
	const wanted = goalName(idOrName);
	if (!wanted) return undefined;

	const byId = getGoal(wanted);
	if (byId?.board === boardId) return byId;

	// The oldest of a name, should two machines have made one each.
	const name = wanted.toLowerCase();
	return boardGoals(boardId).find(goal => goal.name.toLowerCase() === name);
};

const isClosed = (ticket: Ticket) => ticket.parentNodeId === CLOSED_SWIMLANE_ID;

/**
 * The boards whose goals a ticket can be in: the one it stands on, or, once
 * closed, every one it stood on, so closing keeps it counted as done.
 */
export const ticketGoalBoards = (ticket: Ticket): string[] => {
	if (isClosed(ticket)) return boardsEverOnOf(ticket);
	const board = ticketBoardId(ticket);
	return board ? [board] : [];
};

/** One of the goals a ticket can be in, by id or name. */
export const findTicketGoal = (
	ticket: Ticket,
	idOrName: string,
): Goal | undefined =>
	ticketGoalBoards(ticket)
		.map(board => findGoal(board, idOrName))
		.find(goal => goal !== undefined);

/**
 * The goal a ticket belongs to, while it has not been removed and the ticket
 * stands on its board: moved to another board, it draws none there and
 * counts for none here, and moving back restores it.
 */
export const getTicketGoal = (ticket: Ticket): Goal | undefined => {
	const goal = ticket.props?.goal ? getGoal(ticket.props.goal) : undefined;
	return goal && ticketGoalBoards(ticket).includes(goal.board)
		? goal
		: undefined;
};

/** Why a ticket may not start a new goal by name, or null when it may. */
export const newGoalRefusal = (ticket: Ticket, name: string): string | null => {
	if (isClosed(ticket))
		return 'A closed ticket starts no goal; reopen it first';
	const board = ticketBoardId(ticket);
	return goalBoardRefusal(board) ?? goalNameRefusal(board ?? '', name);
};

/** Why a board may not take a new goal, or a change to one, or null. */
export const goalBoardRefusal = (
	boardId: string | undefined,
): string | null => {
	const board = boardId ? nodesOrNone()[boardId] : undefined;
	if (!board || board.isDeleted || board.context !== 'BOARD') {
		return 'Board not found';
	}
	return board.readonly ? 'Board is readonly' : null;
};

/** Muted, and from the id, so renaming a goal keeps its colour. */
export const goalColor = (goal: Goal): string => getMutedStringColor(goal.id);

/** The board a ticket stands on: its lane's parent. */
export const ticketBoardId = (ticket: Ticket): string | undefined => {
	const lane = ticket.parentNodeId
		? nodesOrNone()[ticket.parentNodeId]
		: undefined;
	return lane?.parentNodeId ?? undefined;
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

/**
 * How far along a goal is, over every ticket in it, however long ago it was
 * closed: done is closed, or standing in a lane called Done.
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

/** Why a goal may not be named so on its board, or null when it may. */
export const goalNameRefusal = (
	boardId: string,
	name: string,
	exceptId?: string,
): string | null => {
	if (!goalName(name)) return 'A goal needs a name';

	const taken = findGoal(boardId, name);
	return taken && taken.id !== exceptId
		? `This board already has a goal called "${taken.name}"`
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
