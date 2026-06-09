export type GuiTag = {id: string; name: string; color: string};
export type GuiAssignee = {id: string; name: string; color: string};

export type GuiIssue = {
	isClosed: boolean;
	id: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: GuiTag[];
	assignees: GuiAssignee[];
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
	contributors: GuiAssignee[];
};
export type Result<T> = {
	value?: T;
	content?: Array<{type: string; text: string}>;
};
export type DropTarget = {
	swimlaneId: string;
	index: number;
};
