import type {NavigationTree} from './navigation.model.js';

export const BoardItemTypes = {
	TICKET: 'TICKET',
	SWIMLANE: 'SWIMLANE',
	BOARD: 'BOARD',
} as const;

export type Ticket = NavigationTree<{
	type: (typeof BoardItemTypes)['TICKET'];
	id: string;
	description?: string;
}>;

export type Swimlane = NavigationTree<{
	type: (typeof BoardItemTypes)['SWIMLANE'];
	id: string;
}> & {children: Ticket[]};

export type Board = NavigationTree<{
	type: (typeof BoardItemTypes)['BOARD'];
	id: string;
}> & {children: Swimlane[]};
