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

// A comment as epiq_issue_get carries it: what a thread is read for, and
// nothing the GUI needs to draw one.
export type ApiIssueComment = {
	id: string;
	author: string;
	createdAt: number;
	body: string;
};

export type ApiIssue = {
	id: string;
	ref: string;
	title: string;
	description: string;
	/** Decoded from the issue's own ULID. */
	createdAt: number;
	readonly: boolean;
	/** Present only for a load-derived lock, which knows why it exists. */
	tags: ApiTag[];
	assignees: ApiAssignee[];
	parentNodeId: string;
	isClosed: boolean;
};

export type ApiIssueDetail = ApiIssue & {comments: ApiIssueComment[]};

// One write over many tickets: which went through and which did not, and
// why. A failure is per ticket, not per call.
export type ApiBatchOutcome = {
	done: {id: string; ref: string}[];
	failed: {id: string; ref: string; reason: string}[];
};

// What a list is scanned for: enough to pick a ticket out and take its ref,
// and nothing that runs to paragraphs.
export type ApiIssueBrief = {
	id: string;
	ref: string;
	title: string;
	swimlane: string;
	tags: string[];
	assignees: string[];
};

export type ApiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	/** Present only for a load-derived lock, which knows why it exists. */
	issues: ApiIssue[];
	parentNodeId: string;
};

// One line of a ticket's own event log. `label` is the same phrasing the TUI
// history uses; the colour is resolved here because getStringColor pulls in
// chalk, which the GUI bundle cannot take.
export type ApiIssueHistoryEntry = {
	id: string;
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
	/** Present only for a load-derived lock, which knows why it exists. */
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
