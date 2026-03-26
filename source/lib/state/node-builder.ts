import {NavNodeCtx} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export const nodes = {
	workspace: (id: string, name: string): NavNode<'WORKSPACE'> => ({
		id,
		title: name,
		props: {},
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
		props: {},
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
		props: {},
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
		props: NavNode<'FIELD'>['props'],
	): NavNode<'FIELD'> => ({
		id,
		title: name,
		props,
		context: NavNodeCtx.FIELD,
		childRenderAxis: 'vertical',
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
		props: {},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		children: [],
	}),
};
