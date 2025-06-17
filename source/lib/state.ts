import {ActionEntry, Mode} from './types/action-map.model.js';
import {Board, Swimlane, Ticket} from './types/board.model.js';

export const navigationState: {
	mode: Mode;
	availableActions:
		| ActionEntry<[Board]>[]
		| ActionEntry<[Board, Swimlane]>[]
		| ActionEntry<[Board, Swimlane, Ticket]>[];
} = {
	mode: 'default',
	availableActions: [],
};
