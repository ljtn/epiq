import {
	AnyContext,
	BoardContext,
	NavNodeCtx,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	WorkspaceContext,
} from '../model/context.model.js';
import {storageManager} from '../storage/storage-manager.js';
import {NavNode} from '../model/navigation-node.model.js';
import {
	StorageNodeType,
	StorageNodeTypes,
	WorkspaceDiskNode,
} from '../model/storage-node.model.js';

export const nodeMapper = {
	resolveFields(data: WorkspaceDiskNode): Record<string, string> {
		return Object.fromEntries(
			Object.entries(data.fields).map(([key, resourceId]) => {
				return [key, storageManager.getResource(resourceId)];
			}),
		);
	},

	toNavNode(ctx: AnyContext, node: any) {
		const mapMethods = {
			WORKSPACE: this.toWorkspace(node),
			BOARD: this.toBoard(node),
			SWIMLANE: this.toSwimlane(node),
			TICKET: this.toIssue(node),
			FIELD: this.toField(node),
		};
		return mapMethods[ctx];
	},

	contextToNodeTypeMap(ctx: AnyContext): StorageNodeType {
		const ctxMap = {
			WORKSPACE: StorageNodeTypes.WORKSPACE,
			BOARD: StorageNodeTypes.BOARD,
			SWIMLANE: StorageNodeTypes.SWIMLANE,
			TICKET: StorageNodeTypes.ISSUE,
			FIELD: StorageNodeTypes.FIELD,
		} as const;
		return ctxMap[ctx];
	},

	toParentNodeType(nodeType: StorageNodeType): StorageNodeType | null {
		const typeMap = {
			workspaces: null,
			boards: StorageNodeTypes.WORKSPACE,
			swimlanes: StorageNodeTypes.BOARD,
			issues: StorageNodeTypes.SWIMLANE,
			fields: StorageNodeTypes.ISSUE,
		} as const;
		return typeMap[nodeType];
	},

	toWorkspace(data: WorkspaceDiskNode): NavNode<WorkspaceContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: NavNodeCtx.WORKSPACE,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('boards', childId);
				if (item) acc.push(this.toBoard(item));
				return acc;
			}, [] as NavNode<BoardContext>[]),
		} satisfies NavNode<WorkspaceContext>;
	},

	toBoard(data: WorkspaceDiskNode): NavNode<BoardContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: NavNodeCtx.BOARD,
			isSelected: false,
			childRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('swimlanes', childId);
				if (item) acc.push(this.toSwimlane(item));
				return acc;
			}, [] as NavNode<SwimlaneContext>[]),
		} satisfies NavNode<BoardContext>;
	},

	toSwimlane(data: WorkspaceDiskNode): NavNode<SwimlaneContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: NavNodeCtx.SWIMLANE,
			isSelected: false,
			childRenderAxis: 'vertical',
			childNavigationAcrossParents: true,
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('issues', childId);
				if (item) acc.push(this.toIssue(item));
				return acc;
			}, [] as NavNode<TicketContext>[]),
		} satisfies NavNode<SwimlaneContext>;
	},

	toIssue(data: WorkspaceDiskNode): NavNode<TicketContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: NavNodeCtx.TICKET,
			isSelected: false,
			childRenderAxis: 'vertical',

			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('fields', childId);
				if (item) acc.push(this.toField(item));
				return acc;
			}, [] as NavNode<TicketFieldContext>[]),
		} satisfies NavNode<TicketContext>;
	},

	toField(data: WorkspaceDiskNode): NavNode<TicketFieldContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: NavNodeCtx.FIELD,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: [],
		} satisfies NavNode<TicketFieldContext>;
	},
};
