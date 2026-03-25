import {NavNodeCtx} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export const nodes = {
	workspace: (id: string, name: string): NavNode<'WORKSPACE'> => ({
		id,
		title: name,
		props: {value: ''},
		context: NavNodeCtx.WORKSPACE,
		childRenderAxis: 'vertical',
		parentNodeId: null,
		children: [],
	}),

	board: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'BOARD'> => ({
		id,
		title: name,
		props: {value: ''},
		context: NavNodeCtx.BOARD,
		childRenderAxis: 'horizontal',
		parentNodeId,
		children: [],
	}),

	swimlane: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'SWIMLANE'> => ({
		id,
		title: name,
		props: {value: ''},
		context: NavNodeCtx.SWIMLANE,
		childRenderAxis: 'vertical',
		childNavigationAcrossParents: true,
		parentNodeId,
		children: [],
	}),

	field: (
		id: string,
		name: string,
		parentNodeId: string,
		value = '',
	): NavNode<'FIELD'> => ({
		id,
		title: name,
		props: {value},
		context: NavNodeCtx.FIELD,
		childRenderAxis: 'vertical',
		parentNodeId,
		children: [],
	}),

	fieldList: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'FIELD_LIST'> => ({
		id,
		title: name,
		props: {value: ''},
		context: NavNodeCtx.FIELD_LIST,
		childRenderAxis: 'horizontal',
		parentNodeId,
		children: [],
	}),

	ticket: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'TICKET'> => ({
		id,
		title: name,
		props: {value: ''},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		children: [],
	}),
};
