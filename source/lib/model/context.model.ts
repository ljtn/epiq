import type {NavNode} from './navigation-node.model.js';

export const NavNodeCtx = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET: 'TICKET',
	FIELD: 'FIELD',
	FIELD_LIST: 'FIELD_LIST',
} as const;

export type Workspace = NavNode<'WORKSPACE'>;
export type Board = NavNode<'BOARD'>;
export type Swimlane = NavNode<'SWIMLANE'>;
export type Ticket = NavNode<'TICKET'>;
export type Field = NavNode<'FIELD'>;
export type FieldList = NavNode<'FIELD_LIST'>;

export type WorkspaceContext = typeof NavNodeCtx.WORKSPACE;
export type BoardContext = typeof NavNodeCtx.BOARD;
export type SwimlaneContext = typeof NavNodeCtx.SWIMLANE;
export type TicketContext = typeof NavNodeCtx.TICKET;
export type TicketFieldContext = typeof NavNodeCtx.FIELD;
export type TicketFieldListContext = typeof NavNodeCtx.FIELD_LIST;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof NavNodeCtx;

export function isTicketNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketContext> {
	return node.context === 'TICKET';
}
export function isFieldNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketFieldContext> {
	return node.context === 'FIELD';
}
export function isFieldListNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketFieldListContext> {
	return node.context === 'FIELD_LIST';
}
