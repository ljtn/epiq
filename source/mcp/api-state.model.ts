export type ApiTag = {id: string; name: string; color: string};

export type ApiAssignee = {
	id: string;
	name: string;
	color: string;
};

export type ApiComment = {
	id: string;
	issueId: string;
	body: string;
	author: ApiAssignee;
	createdAt: number;
};

export type ApiIssue = {
	id: string;
	ref: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: ApiTag[];
	assignees: ApiAssignee[];
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
	ref: string;
	title: string;
	swimlanes: ApiSwimlane[];
};

export type ApiAttachment = {
	id: string;
	issueId: string;
	name: string;
	/** Content-addressed blob name, served at /media/<fileName> */
	fileName: string;
	bytes: number;
	createdAt: number;
	canDelete: boolean;
};

export type ApiState = {
	tags: ApiTag[];
	contributors: ApiAssignee[];
	user: ApiAssignee;
	boards: ApiBoard[];
	commentsByIssueId: Record<string, ApiComment[]>;
	attachmentsByIssueId: Record<string, ApiAttachment[]>;
	attachmentMaxKb: number;
};
