export type GuiTag = {id: string; name: string; color: string};
export type GuiUser = {id: string; name: string; color: string};

export type GuiComment = {
	id: string;
	issueId: string;
	body: string;
	author: GuiUser;
	createdAt: number;
	isDeleted?: boolean;
};

export type GuiIssue = {
	isClosed: boolean;
	id: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: GuiTag[];
	assignees: GuiUser[];
};

export type GuiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	issues: GuiIssue[];
};

type GuiBoard = {
	id: string;
	title: string;
	swimlanes: GuiSwimlane[];
};

export type GuiState = {
	boards: GuiBoard[];
	tags: GuiTag[];
	contributors: GuiUser[];
	user: GuiUser;
	commentsByIssueId: Record<string, GuiComment[]>;
};
