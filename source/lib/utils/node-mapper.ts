import {
	AnyContext,
	BoardContext,
	contextMap,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	WorkspaceContext,
} from '../model/context.model.js';
import {
	NodeType,
	storageManager,
	WorkspaceDiskNode,
} from '../storage/storage-manager.js';
import {NavNode} from '../model/navigation-node.model.js';

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

	contextToNodeTypeMap(ctx: AnyContext): NodeType {
		const ctxMap = {
			WORKSPACE: 'workspaces',
			BOARD: 'boards',
			SWIMLANE: 'swimlanes',
			TICKET: 'issues',
			FIELD: 'fields',
		} as const;
		return ctxMap[ctx];
	},

	toWorkspace(data: WorkspaceDiskNode): NavNode<WorkspaceContext> {
		return {
			id: data.id,
			fields: this.resolveFields(data),
			context: contextMap.WORKSPACE,
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
			context: contextMap.BOARD,
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
			context: contextMap.SWIMLANE,
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
			context: contextMap.TICKET,
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
			context: contextMap.FIELD,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: [],
		} satisfies NavNode<TicketFieldContext>;
	},
};
