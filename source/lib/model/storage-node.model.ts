export const StorageNodeTypes = {
	WORKSPACE: 'workspace',
	BOARD: 'board',
	SWIMLANE: 'swimlane',
	ISSUE: 'issue',
	FIELD: 'field',
	FIELD_LIST: 'list',
} as const;

export type StorageNodeType =
	(typeof StorageNodeTypes)[keyof typeof StorageNodeTypes];

export type WorkspaceDiskNode = {
	id: string;
	type: StorageNodeType;
	name: string;
	props: Record<string, string>;
};

export type WorkspaceDiskNodeComposed = WorkspaceDiskNode & {
	children: string[] | [];
};
