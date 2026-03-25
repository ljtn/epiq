import {ulid} from 'ulid';
import {NavNodeCtx} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export const nodeBuilder = {
	workspace: (name: string): NavNode<'WORKSPACE'> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.WORKSPACE,
		childRenderAxis: 'vertical',
		parentNodeId: null,
		children: [],
	}),

	board: (name: string, parentNodeId: string): NavNode<'BOARD'> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.BOARD,
		childRenderAxis: 'horizontal',
		parentNodeId,
		children: [],
	}),

	swimlane: (name: string, parentNodeId: string): NavNode<'SWIMLANE'> => ({
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
	): NavNode<'FIELD'> => ({
		id: ulid(),
		name,
		props: {value},
		context: NavNodeCtx.FIELD,
		childRenderAxis: 'vertical',
		parentNodeId,
		children: [],
	}),

	fieldList: (name: string, parentNodeId: string): NavNode<'FIELD_LIST'> => ({
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
	): NavNode<'TICKET'> => ({
		id: ulid(),
		name,
		props: {value: ''},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		children,
	}),
};
