import type {NavigationTree} from '../../navigation/model/navigation-tree.model.js';

export const Context = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET_LIST_ITEM: 'TICKET_LIST_ITEM',
	TICKET: 'TICKET',
} as const;

export type Workspace = NavigationTree<{
	actionContext: (typeof Context)['WORKSPACE'];
}> & {children: Board[]};

export type Board = NavigationTree<{
	actionContext: (typeof Context)['BOARD'];
}> & {children: Swimlane[]};

export type Swimlane = NavigationTree<{
	actionContext: (typeof Context)['SWIMLANE'];
	enableChildNavigationAcrossContainers: true;
}> & {children: TicketListItem[]};

export type TicketListItem = NavigationTree<{
	actionContext: (typeof Context)['TICKET_LIST_ITEM'];
}> & {children: Ticket[]};

export type Ticket = NavigationTree<{
	actionContext: (typeof Context)['TICKET'];
}>;
