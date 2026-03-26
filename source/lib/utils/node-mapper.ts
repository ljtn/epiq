import {
	AnyContext,
	BoardContext,
	NavNodeCtx,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	WorkspaceContext,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {
	StorageNodeType,
	StorageNodeTypes,
	WorkspaceDiskNodeComposed,
} from '../model/storage-node.model.js';
import {storage} from '../storage/storage.js';

export const nodeMapper = {
	contextToNodeTypeMap(ctx: AnyContext): StorageNodeType {
		const ctxMap = {
			WORKSPACE: StorageNodeTypes.WORKSPACE,
			BOARD: StorageNodeTypes.BOARD,
			SWIMLANE: StorageNodeTypes.SWIMLANE,
			TICKET: StorageNodeTypes.ISSUE,
			FIELD: StorageNodeTypes.FIELD,
			FIELD_LIST: StorageNodeTypes.FIELD_LIST,
		} as const;
		return ctxMap[ctx];
	},

	toWorkspace(data: WorkspaceDiskNodeComposed): NavNode<WorkspaceContext> {
		const label = storage.getResource(data.name, 0);
		return {
			id: data.id,
			title: label || '',
			props: {},
			context: NavNodeCtx.WORKSPACE,
			childRenderAxis: 'vertical',
			parentNodeId: null,
			children: data.children,
		} satisfies NavNode<WorkspaceContext>;
	},

	toBoard(data: WorkspaceDiskNodeComposed): NavNode<BoardContext> {
		const label = storage.getResource(data.name, 0);
		return {
			id: data.id,
			title: label || '',
			props: {},
			context: NavNodeCtx.BOARD,
			childRenderAxis: 'horizontal',
			parentNodeId: data.parentNodeId,
			children: data.children,
		} satisfies NavNode<BoardContext>;
	},

	toSwimlane(data: WorkspaceDiskNodeComposed): NavNode<SwimlaneContext> {
		const label = storage.getResource(data.name, 0);

		return {
			id: data.id,
			title: label || '',
			props: {},
			context: NavNodeCtx.SWIMLANE,
			childRenderAxis: 'vertical',
			childNavigationAcrossParents: true,
			parentNodeId: data.parentNodeId,
			children: data.children,
		} satisfies NavNode<SwimlaneContext>;
	},

	toIssue(data: WorkspaceDiskNodeComposed): NavNode<TicketContext> {
		const label = storage.getResource(data.name, 0);
		return {
			id: data.id,
			title: label || '',
			props: {},
			context: NavNodeCtx.TICKET,
			childRenderAxis: 'vertical',
			parentNodeId: data.parentNodeId,
			children: data.children,
		} satisfies NavNode<TicketContext>;
	},

	toField(data: WorkspaceDiskNodeComposed): NavNode<TicketFieldContext> {
		const label = storage.getResource(data.name, 0);
		return {
			id: data.id,
			title: label || '',
			props: {value: ''},
			context: NavNodeCtx.FIELD,
			childRenderAxis: 'vertical',
			parentNodeId: data.parentNodeId,
			children: [],
		} satisfies NavNode<TicketFieldContext>;
	},

	toNavNode(
		data: WorkspaceDiskNodeComposed,
		type: StorageNodeType,
	): NavNode<AnyContext> {
		switch (type) {
			case StorageNodeTypes.WORKSPACE:
				return this.toWorkspace(data);
			case StorageNodeTypes.BOARD:
				return this.toBoard(data);
			case StorageNodeTypes.SWIMLANE:
				return this.toSwimlane(data);
			case StorageNodeTypes.ISSUE:
				return this.toIssue(data);
			case StorageNodeTypes.FIELD:
				return this.toField(data);
			default:
				throw new Error(`Unsupported node type: ${String(type)}`);
		}
	},
};
