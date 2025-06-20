import type {NavigationTree} from './navigation.model.js';

export const BoardItemTypes = {
	TICKET: 'TICKET',
	SWIMLANE: 'SWIMLANE',
	BOARD: 'BOARD',
} as const;

export type Ticket = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['TICKET'];
	description?: string;
}>;

export type Swimlane = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['SWIMLANE'];
}> & {children: Ticket[]};

export type Board = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['BOARD'];
}> & {children: Swimlane[]};
