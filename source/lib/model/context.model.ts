import type {NavNode} from './navigation-node.model.js';

export const NavNodeCtx = {
	WORKSPACE: 'WORKSPACE',
	BOARD: 'BOARD',
	SWIMLANE: 'SWIMLANE',
	TICKET: 'TICKET',
	FIELD: 'FIELD',
	FIELD_LIST: 'FIELD_LIST',
	TEXT: 'TEXT',
} as const;

export type Workspace = NavNode<'WORKSPACE'>;
export type Board = NavNode<'BOARD'>;
export type Swimlane = NavNode<'SWIMLANE'>;
export type Ticket = NavNode<'TICKET'>;
export type Field = NavNode<'FIELD'>;
export type FieldList = NavNode<'FIELD_LIST'>;
export type Text = NavNode<'TEXT'>;

export type WorkspaceContext = typeof NavNodeCtx.WORKSPACE;
export type BoardContext = typeof NavNodeCtx.BOARD;
export type SwimlaneContext = typeof NavNodeCtx.SWIMLANE;
export type TicketContext = typeof NavNodeCtx.TICKET;
export type TicketFieldContext = typeof NavNodeCtx.FIELD;
export type TicketFieldListContext = typeof NavNodeCtx.FIELD_LIST;
export type TextContext = typeof NavNodeCtx.TEXT;

export type AnyContext = ContextMap[keyof ContextMap];
export type ContextMap = typeof NavNodeCtx;

export function isWorkspaceNode(
	node: NavNode<AnyContext>,
): node is NavNode<WorkspaceContext> {
	return node.context === 'WORKSPACE';
}
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

export const isSwimlaneNode = (
	node: NavNode<AnyContext>,
): node is NavNode<'SWIMLANE'> => {
	return node.context === 'SWIMLANE';
};
export const isBoardNode = (
	node: NavNode<AnyContext>,
): node is NavNode<'BOARD'> => {
	return node.context === 'BOARD';
};
