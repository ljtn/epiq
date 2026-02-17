import type {NavNode} from '../navigation/model/navigation-node.model.js';

export const contextMap = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET: 'TICKET',
	TICKET_FIELD: 'TICKET_FIELD',
} as const;

export type Workspace = NavNode<'WORKSPACE'>;
export type Board = NavNode<'BOARD'>;
export type Swimlane = NavNode<'SWIMLANE'>;
export type Ticket = NavNode<'TICKET'>;
export type TicketField = NavNode<'TICKET_FIELD'>;

export type WorkspaceContext = typeof contextMap.WORKSPACE;
export type BoardContext = typeof contextMap.BOARD;
export type SwimlaneContext = typeof contextMap.SWIMLANE;
export type TicketContext = typeof contextMap.TICKET;
export type TicketFieldContext = typeof contextMap.TICKET_FIELD;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof contextMap;
