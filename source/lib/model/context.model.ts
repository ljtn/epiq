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

export type ContextMap = typeof NavNodeCtx;
export type AnyContext = ContextMap[keyof ContextMap];

export type WorkspaceContext = typeof NavNodeCtx.WORKSPACE;
export type BoardContext = typeof NavNodeCtx.BOARD;
export type SwimlaneContext = typeof NavNodeCtx.SWIMLANE;
export type TicketContext = typeof NavNodeCtx.TICKET;
export type TicketFieldContext = typeof NavNodeCtx.FIELD;
export type TicketFieldListContext = typeof NavNodeCtx.FIELD_LIST;
export type TextContext = typeof NavNodeCtx.TEXT;

export type Workspace = NavNode<WorkspaceContext>;
export type Board = NavNode<BoardContext>;
export type Swimlane = NavNode<SwimlaneContext>;
export type Ticket = NavNode<TicketContext>;
export type Field = NavNode<TicketFieldContext>;
export type FieldList = NavNode<TicketFieldListContext>;
export type Text = NavNode<TextContext>;

export function isWorkspaceNode(node: NavNode<AnyContext>): node is Workspace {
	return node.context === NavNodeCtx.WORKSPACE;
}

export function isTicketNode(node: NavNode<AnyContext>): node is Ticket {
	return node.context === NavNodeCtx.TICKET;
}
export function isTextNode(node: NavNode<AnyContext>): node is Text {
	return node.context === NavNodeCtx.TEXT;
}

export function isFieldNode(node: NavNode<AnyContext>): node is Field {
	return node.context === NavNodeCtx.FIELD;
}

export function isFieldListNode(node: NavNode<AnyContext>): node is FieldList {
	return node.context === NavNodeCtx.FIELD_LIST;
}

export const isSwimlaneNode = (node: NavNode<AnyContext>): node is Swimlane => {
	return node.context === NavNodeCtx.SWIMLANE;
};

export const isBoardNode = (node: NavNode<AnyContext>): node is Board => {
	return node.context === NavNodeCtx.BOARD;
};
