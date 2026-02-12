import type {NavigationTree} from '../../navigation/model/navigation-tree.model.js';

export const contextMap = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET_LIST_ITEM: 'TICKET_LIST_ITEM',
	TICKET: 'TICKET',
} as const;

export type Workspace = NavigationTree<'WORKSPACE'>;
export type Board = NavigationTree<'BOARD'>;
export type Swimlane = NavigationTree<'SWIMLANE'>;
export type TicketListItem = NavigationTree<'TICKET_LIST_ITEM'>;
export type Ticket = NavigationTree<'TICKET'>;

export type WorkspaceContext = typeof contextMap.WORKSPACE;
export type BoardContext = typeof contextMap.BOARD;
export type SwimlaneContext = typeof contextMap.SWIMLANE;
export type TicketListItemContext = typeof contextMap.TICKET_LIST_ITEM;
export type TicketContext = typeof contextMap.TICKET;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof contextMap;
