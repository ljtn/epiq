import {board} from '../mock/board.js';
import {Swimlane, Ticket} from './types/board.model.js';
import {NavigationTree} from './types/navigation.model.js';

/**
 * Move a ticket to a new swimlane.
 */
export function moveTicket(ticket: Ticket, destination: Swimlane) {
	let realTicket: Ticket | undefined;

	// Step 1: Find and remove the real ticket from the current swimlane
	for (const swimlane of board.children) {
		const index = swimlane.children.findIndex(t => t.id === ticket.id);
		if (index !== -1) {
			realTicket = swimlane.children[index];
			swimlane.children.splice(index, 1);
			break;
		}
	}

	// Step 2: Add it to the destination swimlane
	if (realTicket && destination.actionContext === 'SWIMLANE') {
		destination.children.push(realTicket);
	} else {
		console.warn('Ticket not found or destination invalid. No move performed.');
	}
}

export function findNodeById(
	tree: NavigationTree,
	id: string,
): NavigationTree | null {
	if (tree.id === id) return tree;
	for (const child of tree.children) {
		const found = findNodeById(child, id);
		if (found) return found;
	}
	return null;
}
