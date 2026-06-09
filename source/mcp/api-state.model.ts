export type ApiIssue = {
	id: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: Array<{id: string; name: string; color: string}>;
	assignees: Array<{id: string; name: string; color: string}>;
	parentNodeId: string;
	isClosed: boolean;
};
export type ApiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	issues: ApiIssue[];
	parentNodeId: string;
};
export type ApiBoard = {
	id: string;
	title: string;
	swimlanes: ApiSwimlane[];
};
export type ApiState = {
	boards: ApiBoard[];
};
