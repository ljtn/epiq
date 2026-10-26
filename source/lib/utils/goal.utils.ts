// A goal is a name in the project that tickets belong to, on whichever board
// they stand; how far along it is comes from those tickets, never from the
// goal itself. The log can hold several goals for a ticket; for now every door
// reads and sets one, the goal it shows. This module answers it for every door:
// the API, the GUI behind it, and the TUI.

import {CLOSED_SWIMLANE_ID} from '../board/static-ids.js';
import {Goal} from '../model/app-state.model.js';
import {isTicketNode, Ticket} from '../model/context.model.js';
import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getMutedStringColor} from './color.js';
import {sanitizeInlineText} from './string.utils.js';
import {isDoneLane} from './lane-rules.js';
import {boardsEverOnOf} from './ticket-boards.js';

// No state, or one with no nodes yet, still answers: there are no goals.
const stateOrNone = () => {
	const state = getSafeState();
	return isFail(state) ? null : state.value;
};
const nodesOrNone = () => stateOrNone()?.nodes ?? {};
const goalsOrNone = () => stateOrNone()?.goals ?? {};

/** A goal that has not been removed. */
export const getGoal = (id: string): Goal | undefined =>
	stateOrNone() ? nodeRepo.getGoal(id) : undefined;

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

/**
 * The goal a ticket belongs to: the first it joined that has not been
 * removed. Two machines setting one at once can leave it in more.
 */
export const getTicketGoal = (ticket: Ticket): Goal | undefined => {
	for (const id of ticket.props?.goals ?? []) {
		const goal = getGoal(id);
		if (goal) return goal;
	}
	return undefined;
};

/**
 * The events that leave a ticket in just the goal named, or in none: every
 * door sets one goal, whatever the log holds.
 */
export const oneGoalChanges = (
	ticket: Ticket,
	goalId: string | undefined,
): Array<{
	action: 'add.issue.goal' | 'remove.issue.goal';
	payload: {id: string; goal: string};
}> => {
	const goals = ticket.props?.goals ?? [];
	return [
		...goals
			.filter(goal => goal !== goalId)
			.map(goal => ({
				action: 'remove.issue.goal' as const,
				payload: {id: ticket.id, goal},
			})),
		...(goalId && !goals.includes(goalId)
			? [
					{
						action: 'add.issue.goal' as const,
						payload: {id: ticket.id, goal: goalId},
					},
			  ]
			: []),
	];
};

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

// Who belongs to which goal, and which of them each board shows, worked out
// once per state: a terminal row asks for every ticket on screen, on every key
// press, and the GUI for every board's goals on every broadcast. Keyed by the
// state object, which every write replaces, batched ones included; the nodes
// map is not, as a batch writes into it in place. A deleted lane or board marks
// its tickets deleted, so they leave with it.
type Membership = {
	members: Map<string, Ticket[]>;
	onBoard: Map<string, Map<string, Ticket[]>>;
};
const membershipCache = new WeakMap<object, Membership>();

const membership = (): Membership => {
	const state = stateOrNone();
	if (!state) return {members: new Map(), onBoard: new Map()};
	const cached = membershipCache.get(state);
	if (cached) return cached;

	const members = new Map<string, Ticket[]>();
	const onBoard = new Map<string, Map<string, Ticket[]>>();
	for (const node of Object.values(nodesOrNone())) {
		if (!isTicketNode(node) || node.isDeleted) continue;
		const goal = getTicketGoal(node)?.id;
		if (!goal) continue;

		const inGoal = members.get(goal) ?? [];
		inGoal.push(node);
		members.set(goal, inGoal);

		const boards = onBoard.get(goal) ?? new Map<string, Ticket[]>();
		for (const board of ticketBoards(node)) {
			const onIt = boards.get(board) ?? [];
			onIt.push(node);
			boards.set(board, onIt);
		}
		onBoard.set(goal, boards);
	}

	const result = {members, onBoard};
	membershipCache.set(state, result);
	return result;
};

export const goalMembers = (goalId: string): Ticket[] =>
	membership().members.get(goalId) ?? [];

/** The boards that show a goal's tickets. */
export const goalBoards = (goalId: string): string[] => [
	...(membership().onBoard.get(goalId)?.keys() ?? []),
];

/** The tickets of a goal a board shows. */
export const goalMembersOn = (goalId: string, boardId: string): Ticket[] =>
	membership().onBoard.get(goalId)?.get(boardId) ?? [];

/** The goals a board shows: those with a ticket on it. */
export const boardGoals = (boardId: string): Goal[] =>
	projectGoals().filter(goal => goalMembersOn(goal.id, boardId).length > 0);

/**
 * How far along a goal is, over every ticket in it on every board, however
 * long ago it was closed: done is closed, or standing in a done lane.
 */
export const goalProgress = (goalId: string): {done: number; total: number} => {
	const members = goalMembers(goalId);
	return {done: members.filter(isGoalTicketDone).length, total: members.length};
};

/** Whether a ticket counts as done for its goal: closed, or in a done lane. */
export const isGoalTicketDone = (ticket: Ticket): boolean =>
	ticket.parentNodeId === CLOSED_SWIMLANE_ID ||
	isDoneLane(ticket.parentNodeId ?? '');

/** Why a goal may not be named so, or null when it may. */
export const goalNameRefusal = (
	name: string,
	exceptId?: string,
): string | null => {
	const wanted = goalName(name);
	if (!wanted) return 'A goal needs a name';
	// An id that names no goal is a mistake, not a name for a new one.
	if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(wanted) && !getGoal(wanted)) {
		return `No goal has the id ${wanted}`;
	}

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
