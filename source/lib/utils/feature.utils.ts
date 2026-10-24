// A feature is a ticket standing for a bigger thing other tickets belong to.
// A ticket belongs to one feature at most, one level deep, so the mark it
// carries is never ambiguous; tags stay the way to say several things. This
// module answers it for every door: the API, the GUI behind it, and the TUI.

import {isTicketNode, Ticket} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {getStringColor} from './color.js';
import {NODE_REF_LENGTH, nodeRef} from './node-ref.js';
import {sanitizeInlineText} from './string.utils.js';

// A state with no nodes yet still answers: there are no features.
const nodesOrNone = () => getState().nodes ?? {};

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

/** The feature a ticket belongs to, while that ticket still exists. */
export const getTicketFeature = (ticket: Ticket): Ticket | undefined =>
	ticket.props?.feature ? findTicket(ticket.props.feature) : undefined;

/** Its own colour, or the one its title derives, as a tag's does. */
export const featureColor = (feature: Ticket): string =>
	feature.props.color ?? getStringColor(sanitizeInlineText(feature.title));

export const featureMembers = (featureId: string): Ticket[] =>
	liveTickets().filter(ticket => ticket.props.feature === featureId);

/** Every ticket some ticket belongs to. */
export const existingFeatures = (): Ticket[] => {
	const tickets = liveTickets();
	const ids = new Set(tickets.flatMap(ticket => ticket.props.feature ?? []));

	return tickets.filter(ticket => ids.has(ticket.id));
};

/** Why `ticket` may not be put in `feature`, or null when it may. */
export const featureRefusal = (
	ticket: Ticket,
	feature: Ticket,
): string | null => {
	if (feature.id === ticket.id) return 'A ticket is not its own feature';

	if (feature.props.feature) {
		return `${nodeRef(
			feature.id,
		)} is itself in a feature; pick that feature instead`;
	}

	if (featureMembers(ticket.id).length > 0) {
		return `${nodeRef(ticket.id)} is a feature; it is in none itself`;
	}

	return null;
};

/**
 * What a terminal row says of a ticket's feature: the one it belongs to, or,
 * on a feature, how many belong to it. `width` bounds the text; 0 asks only
 * whether there is a mark and its colour.
 */
export const featureMark = (
	ticket: Ticket,
	width: number,
): {text: string; color: string; isFeature: boolean} | null => {
	const feature = getTicketFeature(ticket);
	if (feature) {
		const text = `◆ ${sanitizeInlineText(feature.title)}`;
		return {
			text:
				text.length > width
					? `${text.slice(0, Math.max(1, width - 1))}…`
					: text,
			color: featureColor(feature),
			isFeature: false,
		};
	}

	const members = featureMembers(ticket.id).length;
	if (members === 0) return null;

	return {
		text: `◆ feature (${members})`,
		color: featureColor(ticket),
		isFeature: true,
	};
};
