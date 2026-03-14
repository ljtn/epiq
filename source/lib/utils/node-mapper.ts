import {
	AnyContext,
	BoardContext,
	NavNodeCtx,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	TicketFieldListContext,
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
			FIELD_LIST: StorageNodeTypes.FIELD,
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
			[NavNodeCtx.FIELD_LIST]: NavNodeCtx.TICKET,
		} as const;
		return typeMap[nodeType];
	},
	toChildStorageNodeType(nodeType: StorageNodeType): StorageNodeType | null {
		const typeMap = {
			[StorageNodeTypes.WORKSPACE]: StorageNodeTypes.BOARD,
			[StorageNodeTypes.BOARD]: StorageNodeTypes.SWIMLANE,
			[StorageNodeTypes.SWIMLANE]: StorageNodeTypes.ISSUE,
			[StorageNodeTypes.ISSUE]: StorageNodeTypes.FIELD,
			[StorageNodeTypes.FIELD]: StorageNodeTypes.FIELD,
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
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.WORKSPACE,
			childRenderAxis: 'vertical',

			children: data.children.reduce((acc, childId) => {
				const item = storage.getNode(StorageNodeTypes.BOARD, childId);
				if (item) acc.push(this.toBoard(item));
				return acc;
			}, [] as NavNode<BoardContext>[]),
		} satisfies NavNode<WorkspaceContext>;
	},

	toBoard(data: WorkspaceDiskNodeComposed): NavNode<BoardContext> {
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.BOARD,
			childRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				const item = storage.getNode(StorageNodeTypes.SWIMLANE, childId);
				if (item) acc.push(this.toSwimlane(item));
				return acc;
			}, [] as NavNode<SwimlaneContext>[]),
		} satisfies NavNode<BoardContext>;
	},

	toSwimlane(data: WorkspaceDiskNodeComposed): NavNode<SwimlaneContext> {
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.SWIMLANE,
			childRenderAxis: 'vertical',
			childNavigationAcrossParents: true,
			children: data.children.reduce((acc, childId) => {
				const item = storage.getNode(StorageNodeTypes.ISSUE, childId);
				if (item) acc.push(this.toIssue(item));
				return acc;
			}, [] as NavNode<TicketContext>[]),
		} satisfies NavNode<SwimlaneContext>;
	},

	toIssue(data: WorkspaceDiskNodeComposed): NavNode<TicketContext> {
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.TICKET,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				const item = storage.getNode(StorageNodeTypes.FIELD, childId);
				if (item)
					acc.push(
						item.children.length ? this.toFieldList(item) : this.toField(item),
					);
				return acc;
			}, [] as (NavNode<TicketFieldContext> | NavNode<TicketFieldListContext>)[]),
		} satisfies NavNode<TicketContext>;
	},

	toField(data: WorkspaceDiskNodeComposed): NavNode<TicketFieldContext> {
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
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

	toFieldList(
		data: WorkspaceDiskNodeComposed,
	): NavNode<TicketFieldListContext> {
		const label = storage.getResource(data.name, 0);
		const value = data.props['value']
			? storage.getResource(data.props['value'], 0)
			: '';
		return {
			id: data.id,
			name: label || '',
			props: {value: value || ''},
			context: NavNodeCtx.FIELD_LIST,
			childRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				const item = storage.getNode(StorageNodeTypes.FIELD, childId);
				if (item) acc.push(this.toField(item));
				return acc;
			}, [] as NavNode<TicketFieldContext>[]),
		} satisfies NavNode<TicketFieldListContext>;
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
				return data.children.length
					? this.toFieldList(data)
					: this.toField(data);
			default:
				throw new Error(`Unsupported node type: ${String(type)}`);
		}
	},
};
