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

// One line of a ticket's own event log. `label` is the same phrasing the TUI
// history uses; the colour is resolved here because getStringColor pulls in
// chalk, which the GUI bundle cannot take.
export type ApiIssueHistoryEntry = {
	t: number;
	action: string;
	label: string;
	actor: {id: string; name: string; color: string};
};

export type ApiBoard = {
	id: string;
	ref: string;
	title: string;
	// True for the Closed board, and for every board while time travel is
	// scrubbed — the same forcing the swimlanes and issues below already get.
	readonly: boolean;
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

export type ApiTimeTravelStatus = {
	mode: 'live' | 'scrub';
	asOfTime: number | null;
};

export type ApiState = {
	tags: ApiTag[];
	contributors: ApiAssignee[];
	user: ApiAssignee;
	boards: ApiBoard[];
	commentsByIssueId: Record<string, ApiComment[]>;
	attachmentsByIssueId: Record<string, ApiAttachment[]>;
	attachmentMaxKb: number;
	timeTravel: ApiTimeTravelStatus;
};
