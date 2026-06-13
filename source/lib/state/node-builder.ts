import {AnyContext, Comment, NavNodeCtx, Text} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';

export const nodes = {
	workspace: (
		id: string,
		name: string,
		rank: string,
	): NavNode<'WORKSPACE'> => ({
		id,
		title: name,
		rank,
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
		rank: string,
		readonly = false,
	): NavNode<'BOARD'> => ({
		id,
		title: name,
		rank,
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
		rank: string,
	): NavNode<'SWIMLANE'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props: {},
		context: NavNodeCtx.SWIMLANE,
		childRenderAxis: 'vertical',
		childNavigationAcrossParents: true,
		parentNodeId,
		readonly: false,
		log: [],
	}),

	field: ({
		id,
		name,
		parentNodeId,
		rank,
		props = {},
		childRenderAxis = 'horizontal',
		isVirtual = false,
	}: {
		id: string;
		name: string;
		parentNodeId: string;
		rank: string;
		props?: NavNode<'FIELD'>['props'];
		childRenderAxis?: NavNode<AnyContext>['childRenderAxis'];
		isVirtual?: boolean;
	}): NavNode<'FIELD'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props,
		context: NavNodeCtx.FIELD,
		childRenderAxis,
		parentNodeId,
		readonly: false,
		log: [],
		isVirtual,
	}),

	fieldList: ({
		id,
		name,
		parentNodeId,
		rank,
		childRenderAxis = 'horizontal',
		isVirtual = false,
	}: {
		id: string;
		name: string;
		parentNodeId: string;
		rank: string;
		childRenderAxis?: NavNode<AnyContext>['childRenderAxis'];
		isVirtual?: boolean;
	}): NavNode<'FIELD_LIST'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props: {},
		context: NavNodeCtx.FIELD_LIST,
		childRenderAxis,
		parentNodeId,
		readonly: false,
		log: [],
		isVirtual,
	}),

	ticket: (
		id: string,
		name: string,
		parentNodeId: string,
		rank: string,
	): NavNode<'TICKET'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props: {},
		context: NavNodeCtx.TICKET,
		childRenderAxis: 'vertical',
		parentNodeId,
		readonly: false,
		log: [],
	}),

	text: ({
		id,
		name,
		parentNodeId,
		rank,
		readonly = true,
		isVirtual = true,
	}: {
		id: string;
		name: string;
		parentNodeId: string;
		rank: string;
		props?: Text['props'];
		isVirtual?: boolean;
		readonly?: boolean;
	}): NavNode<'TEXT'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props: {},
		context: NavNodeCtx.TEXT,
		childRenderAxis: 'vertical',
		parentNodeId,
		readonly,
		log: [],
		isVirtual,
	}),

	comment: ({
		id,
		name,
		parentNodeId,
		rank,
		props = {},
		readonly = true,
		isVirtual = true,
	}: {
		id: string;
		name: string;
		parentNodeId: string;
		rank: string;
		props?: Comment['props'];
		isVirtual?: boolean;
		readonly?: boolean;
	}): NavNode<'COMMENT'> => ({
		id,
		title: name,
		rank,
		isDeleted: false,
		props,
		context: NavNodeCtx.COMMENT,
		childRenderAxis: 'vertical',
		parentNodeId,
		readonly,
		log: [],
		isVirtual,
	}),
};
