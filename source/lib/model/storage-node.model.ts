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
	props: Record<string, string>;
};

export type WorkspaceDiskNodeComposed = {
	id: string;
	name: string;
	props: Record<string, string>;
	children: string[] | [];
};
