export const StorageNodeTypes = {
	WORKSPACE: 'workspace',
	BOARD: 'board',
	SWIMLANE: 'swimlane',
	ISSUE: 'issue',
	FIELD: 'field',
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
