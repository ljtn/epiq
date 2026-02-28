import type {NavNode} from './navigation-node.model.js';

export const NavNodeType = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET: 'TICKET',
	FIELD: 'FIELD',
} as const;

export type Workspace = NavNode<'WORKSPACE'>;
export type Board = NavNode<'BOARD'>;
export type Swimlane = NavNode<'SWIMLANE'>;
export type Ticket = NavNode<'TICKET'>;
export type Field = NavNode<'FIELD'>;

export type WorkspaceContext = typeof NavNodeType.WORKSPACE;
export type BoardContext = typeof NavNodeType.BOARD;
export type SwimlaneContext = typeof NavNodeType.SWIMLANE;
export type TicketContext = typeof NavNodeType.TICKET;
export type TicketFieldContext = typeof NavNodeType.FIELD;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof NavNodeType;
