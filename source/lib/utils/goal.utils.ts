// A goal is a ticket standing for a bigger thing other tickets belong to.
// A ticket belongs to one goal at most, one level deep, so the mark it
// carries is never ambiguous; tags stay the way to say several things. This
// module answers it for every door: the API, the GUI behind it, and the TUI.

import {CLOSED_SWIMLANE_ID} from '../board/static-ids.js';
import {isTicketNode, Ticket} from '../model/context.model.js';
import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';
import {getMutedStringColor} from './color.js';
import {NODE_REF_LENGTH, nodeRef} from './node-ref.js';
import {sanitizeInlineText} from './string.utils.js';

// No state, or one with no nodes yet, still answers: there are no goals.
const stateOrNone = () => {
	const state = getSafeState();
	return isFail(state) ? null : state.value;
};
const nodesOrNone = () => stateOrNone()?.nodes ?? {};

const liveTickets = (): Ticket[] =>
	Object.values(nodesOrNone()).filter(
		(node): node is Ticket => isTicketNode(node) && !node.isDeleted,
	);

/** A live ticket by full id or by ref. */
export const findTicket = (idOrRef: string): Ticket | undefined => {
	const raw = idOrRef.trim();
	if (!raw) return undefined;

	if (raw.length > NODE_REF_LENGTH) {
		const node = nodesOrNone()[raw];
		return node && !node.isDeleted && isTicketNode(node) ? node : undefined;
	}

	const ref = raw.toUpperCase();
	return liveTickets().find(ticket => nodeRef(ticket.id) === ref);
};

/** The goal a ticket belongs to, while that ticket still exists. */
export const getTicketGoal = (ticket: Ticket): Ticket | undefined =>
	ticket.props?.goal ? findTicket(ticket.props.goal) : undefined;

/** The colour its title derives, muted: it marks every ticket in the goal. */
export const goalColor = (goal: Ticket): string =>
	getMutedStringColor(sanitizeInlineText(goal.title));

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
	for (const ticket of liveTickets()) {
		const goal = ticket.props?.goal;
		if (goal) members.set(goal, [...(members.get(goal) ?? []), ticket]);
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
export const goalProgress = (
	goalId: string,
): {done: number; total: number} | null => {
	const members = goalMembers(goalId);
	if (members.length === 0) return null;

	// By name, not by place: lanes are in whatever order a team put them.
	const isDone = (ticket: Ticket) =>
		ticket.parentNodeId === CLOSED_SWIMLANE_ID ||
		nodesOrNone()[ticket.parentNodeId ?? '']?.title.trim().toLowerCase() ===
			'done';

	return {done: members.filter(isDone).length, total: members.length};
};

/** Every live ticket some ticket belongs to. */
export const existingGoals = (): Ticket[] =>
	[...membersByGoal().keys()].flatMap(id => findTicket(id) ?? []);

/** Why `ticket` may not be put in `goal`, or null when it may. */
export const goalRefusal = (ticket: Ticket, goal: Ticket): string | null => {
	if (goal.id === ticket.id) return 'A ticket is not its own goal';

	// Its goal as it stands now: a link to one since deleted is no goal.
	if (getTicketGoal(goal)) {
		return `${nodeRef(goal.id)} is itself in a goal; pick that goal instead`;
	}

	if (goalMembers(ticket.id).length > 0) {
		return `${nodeRef(ticket.id)} is a goal; it is in none itself`;
	}

	return null;
};

/**
 * What a terminal row says of a ticket's goal: the one it belongs to, or,
 * on a goal, how many belong to it. `width` bounds the text; 0 asks only
 * whether there is a mark and its colour.
 */
export const goalMark = (
	ticket: Ticket,
	width: number,
): {text: string; color: string; isGoal: boolean} | null => {
	const goal = getTicketGoal(ticket);
	if (goal) {
		const text = `◆ ${sanitizeInlineText(goal.title)}`;
		return {
			text:
				text.length > width
					? `${text.slice(0, Math.max(1, width - 1))}…`
					: text,
			color: goalColor(goal),
			isGoal: false,
		};
	}

	const members = goalMembers(ticket.id).length;
	if (members === 0) return null;

	return {
		text: `◆ goal (${members})`,
		color: goalColor(ticket),
		isGoal: true,
	};
};
