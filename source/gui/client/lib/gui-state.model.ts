export type GuiIssue = {
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
export type GuiState = {
	board: {
		id: string;
		title: string;
	};
	swimlanes: GuiSwimlane[];
};
export type Result<T> = {
	value?: T;
	content?: Array<{type: string; text: string}>;
};
export type DropTarget = {
	swimlaneId: string;
	index: number;
};
