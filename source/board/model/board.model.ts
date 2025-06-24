import type {NavigationTree} from '../../navigation/model/navigation-tree.model.js';

export const BoardItemTypes = {
	TICKET: 'TICKET',
	TICKET_LIST_ITEM: 'TICKET_LIST_ITEM',
	SWIMLANE: 'SWIMLANE',
	BOARD: 'BOARD',
} as const;

export type Board = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['BOARD'];
}> & {children: Swimlane[]};

export type Swimlane = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['SWIMLANE'];
	enableChildNavigationAcrossContainers: true;
}> & {children: TicketListItem[]};

export type TicketListItem = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['TICKET_LIST_ITEM'];
}> & {children: Ticket[]};

export type Ticket = NavigationTree<{
	actionContext: (typeof BoardItemTypes)['TICKET'];
}>;
