import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {midRank} from '../utils/rank.js';

export const nodes = {
	workspace: (id: string, name: string): NavNode<'WORKSPACE'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props: {},
		context: NavNodeCtx.WORKSPACE,
		childRenderAxis: 'vertical',
		parentNodeId: null,
		readonly: true,
		log: [],
	}),

	board: (
		id: string,
		name: string,
		parentNodeId: string,
		readonly = false,
	): NavNode<'BOARD'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props: {},
		context: NavNodeCtx.BOARD,
		childRenderAxis: 'horizontal',
		parentNodeId,
		readonly,
		log: [],
	}),

	swimlane: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'SWIMLANE'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props: {},
		context: NavNodeCtx.SWIMLANE,
		childRenderAxis: 'vertical',
		childNavigationAcrossParents: true,
		parentNodeId,
		readonly: false,
		log: [],
	}),

	field: (
		id: string,
		name: string,
		parentNodeId: string,
		props: NavNode<'FIELD'>['props'] = {},
		childRenderAxis: NavNode<AnyContext>['childRenderAxis'] = 'horizontal',
	): NavNode<'FIELD'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props,
		context: NavNodeCtx.FIELD,
		childRenderAxis,
		// childNavigationAcrossParents: true, // ??
		parentNodeId,
		readonly: false,
		log: [],
	}),

	ticket: (
		id: string,
		name: string,
		parentNodeId: string,
	): NavNode<'TICKET'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props: {},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		readonly: false,
		log: [],
	}),
	text: (
		id: string,
		name: string,
		parentNodeId: string,
		props: NavNode<'TEXT'>['props'] = {},
	): NavNode<'TEXT'> => ({
		id,
		title: name,
		rank: midRank(),
		isDeleted: false,
		props,
		context: NavNodeCtx.TEXT,
		childRenderAxis: 'vertical',
		parentNodeId,
		readonly: false,
		log: [],
	}),
};
