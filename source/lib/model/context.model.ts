import type {NavNode} from './navigation-node.model.js';

export const NavNodeCtx = {
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

export type WorkspaceContext = typeof NavNodeCtx.WORKSPACE;
export type BoardContext = typeof NavNodeCtx.BOARD;
export type SwimlaneContext = typeof NavNodeCtx.SWIMLANE;
export type TicketContext = typeof NavNodeCtx.TICKET;
export type TicketFieldContext = typeof NavNodeCtx.FIELD;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof NavNodeCtx;
