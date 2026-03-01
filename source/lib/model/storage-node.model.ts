export const StorageNodeTypes = {
	WORKSPACE: 'workspaces',
	BOARD: 'boards',
	SWIMLANE: 'swimlanes',
	ISSUE: 'issues',
	FIELD: 'fields',
} as const;

export type StorageNodeType =
	(typeof StorageNodeTypes)[keyof typeof StorageNodeTypes];

export type WorkspaceDiskNode = {
	id: string;
	name: string;
	children: string[] | [];
	props: Record<string, string>;
};

export type WorkspaceSnapshot = {
	id: string; // version id (ulid)
	createdAt: string;
	rootWorkspaceId: string;
	nodes: {
		[StorageNodeTypes.WORKSPACE]: Record<string, WorkspaceDiskNode>;
		[StorageNodeTypes.BOARD]: Record<string, WorkspaceDiskNode>;
		[StorageNodeTypes.SWIMLANE]: Record<string, WorkspaceDiskNode>;
		[StorageNodeTypes.ISSUE]: Record<string, WorkspaceDiskNode>;
		[StorageNodeTypes.FIELD]: Record<string, WorkspaceDiskNode>;
	};
};
