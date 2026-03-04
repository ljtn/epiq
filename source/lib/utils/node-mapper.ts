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
	WorkspaceDiskNodeComposed,
} from '../model/storage-node.model.js';

export const nodeMapper = {
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

	toParentNavNodeType(nodeType: AnyContext) {
		const typeMap = {
			[NavNodeCtx.WORKSPACE]: null,
			[NavNodeCtx.BOARD]: NavNodeCtx.WORKSPACE,
			[NavNodeCtx.SWIMLANE]: NavNodeCtx.BOARD,
			[NavNodeCtx.TICKET]: NavNodeCtx.SWIMLANE,
			[NavNodeCtx.FIELD]: NavNodeCtx.TICKET,
		} as const;
		return typeMap[nodeType];
	},
	toChildStorageNodeType(nodeType: StorageNodeType): StorageNodeType | null {
		const typeMap = {
			[StorageNodeTypes.WORKSPACE]: StorageNodeTypes.BOARD,
			[StorageNodeTypes.BOARD]: StorageNodeTypes.SWIMLANE,
			[StorageNodeTypes.SWIMLANE]: StorageNodeTypes.ISSUE,
			[StorageNodeTypes.ISSUE]: StorageNodeTypes.FIELD,
			[StorageNodeTypes.FIELD]: null,
		} as const;
		return typeMap[nodeType];
	},

	toParentStorageNodeType(nodeType: StorageNodeType): StorageNodeType | null {
		const typeMap = {
			[StorageNodeTypes.WORKSPACE]: null,
			[StorageNodeTypes.BOARD]: StorageNodeTypes.WORKSPACE,
			[StorageNodeTypes.SWIMLANE]: StorageNodeTypes.BOARD,
			[StorageNodeTypes.ISSUE]: StorageNodeTypes.SWIMLANE,
			[StorageNodeTypes.FIELD]: StorageNodeTypes.ISSUE,
		} as const;
		return typeMap[nodeType];
	},

	toWorkspace(data: WorkspaceDiskNodeComposed): NavNode<WorkspaceContext> {
		const label = storageManager.getResource(data.name, 0);
		const value = data.props['value']
			? storageManager.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.WORKSPACE,
			childRenderAxis: 'vertical',

			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('boards', childId);
				if (item) acc.push(this.toBoard(item));
				return acc;
			}, [] as NavNode<BoardContext>[]),
		} satisfies NavNode<WorkspaceContext>;
	},

	toBoard(data: WorkspaceDiskNodeComposed): NavNode<BoardContext> {
		const label = storageManager.getResource(data.name, 0);
		const value = data.props['value']
			? storageManager.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.BOARD,
			childRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('swimlanes', childId);
				if (item) acc.push(this.toSwimlane(item));
				return acc;
			}, [] as NavNode<SwimlaneContext>[]),
		} satisfies NavNode<BoardContext>;
	},

	toSwimlane(data: WorkspaceDiskNodeComposed): NavNode<SwimlaneContext> {
		const label = storageManager.getResource(data.name, 0);
		const value = data.props['value']
			? storageManager.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.SWIMLANE,
			childRenderAxis: 'vertical',
			childNavigationAcrossParents: true,
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('issues', childId);
				if (item) acc.push(this.toIssue(item));
				return acc;
			}, [] as NavNode<TicketContext>[]),
		} satisfies NavNode<SwimlaneContext>;
	},

	toIssue(data: WorkspaceDiskNodeComposed): NavNode<TicketContext> {
		const label = storageManager.getResource(data.name, 0);
		const value = data.props['value']
			? storageManager.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.TICKET,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				const item = storageManager.getNode('fields', childId);
				if (item) acc.push(this.toField(item));
				return acc;
			}, [] as NavNode<TicketFieldContext>[]),
		} satisfies NavNode<TicketContext>;
	},

	toField(data: WorkspaceDiskNode): NavNode<TicketFieldContext> {
		const label = storageManager.getResource(data.name, 0);
		const value = data.props['value']
			? storageManager.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.FIELD,
			childRenderAxis: 'vertical',
			children: [],
		} satisfies NavNode<TicketFieldContext>;
	},
};
