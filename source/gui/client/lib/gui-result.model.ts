export type Result<T> = {
	value?: T;
	content?: Array<{type: string; text: string}>;
};

export type DropTarget = {
	swimlaneId: string;
	index: number;
};
