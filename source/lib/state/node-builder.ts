import {ulid} from 'ulid';
import {
	BoardContext,
	NavNodeCtx,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	TicketFieldListContext,
	WorkspaceContext,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export const nodeBuilder = {
	workspace: (name: string): NavNode<WorkspaceContext> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.WORKSPACE,
		childRenderAxis: 'vertical',
		parentNodeId: null,
		children: [],
	}),

	board: (name: string, parentNodeId: string): NavNode<BoardContext> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.BOARD,
		childRenderAxis: 'horizontal',
		parentNodeId,
		children: [],
	}),

	swimlane: (name: string, parentNodeId: string): NavNode<SwimlaneContext> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.SWIMLANE,
		childRenderAxis: 'vertical',
		childNavigationAcrossParents: true,
		parentNodeId,
		children: [],
	}),

	field: (
		name: string,
		parentNodeId: string,
		value = '',
	): NavNode<TicketFieldContext> => ({
		id: ulid(),
		name,
		props: {value},
		context: NavNodeCtx.FIELD,
		childRenderAxis: 'vertical',
		parentNodeId,
		children: [],
	}),

	fieldList: (
		name: string,
		parentNodeId: string,
	): NavNode<TicketFieldListContext> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.FIELD_LIST,
		childRenderAxis: 'horizontal',
		parentNodeId,
		children: [],
	}),

	ticket: (
		name: string,
		parentNodeId: string,
		children: string[],
	): NavNode<TicketContext> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		children,
	}),
};
