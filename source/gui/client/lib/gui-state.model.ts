export type GuiIssue = {
	isClosed: boolean;
	id: string;
	title: string;
	description: string;
	readonly: boolean;
	tags: Array<{id: string; name: string}>;
	assignees: Array<{id: string; name: string}>;
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
};
export type Result<T> = {
	value?: T;
	content?: Array<{type: string; text: string}>;
};
export type DropTarget = {
	swimlaneId: string;
	index: number;
};
