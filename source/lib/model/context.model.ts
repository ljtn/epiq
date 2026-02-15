import type {NavNode} from '../navigation/model/navigation-node.model.js';

export const contextMap = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET_LIST_ITEM: 'TICKET_LIST_ITEM',
	TICKET: 'TICKET',
} as const;

export type Workspace = NavNode<'WORKSPACE'>;
export type Board = NavNode<'BOARD'>;
export type Swimlane = NavNode<'SWIMLANE'>;
export type TicketListItem = NavNode<'TICKET_LIST_ITEM'>;
export type Ticket = NavNode<'TICKET'>;

export type WorkspaceContext = typeof contextMap.WORKSPACE;
export type BoardContext = typeof contextMap.BOARD;
export type SwimlaneContext = typeof contextMap.SWIMLANE;
export type TicketListItemContext = typeof contextMap.TICKET_LIST_ITEM;
export type TicketContext = typeof contextMap.TICKET;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof contextMap;
