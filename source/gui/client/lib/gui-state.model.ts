export type GuiTag = {id: string; name: string; color: string};
export type GuiUser = {id: string; name: string; color: string};

// Who can be assigned, as opposed to GuiState.contributors, which is only the
// registry.
export type GuiContributor = GuiUser & {
	isSelf: boolean;
	isRemoved: boolean;
	// Workspace-wide: their name is somewhere in the event log, making name un-clearable.
	hasAuthoredAnywhere: boolean;
};

export type GuiComment = {
	id: string;
	issueId: string;
	body: string;
	author: GuiUser;
	createdAt: number;
	isDeleted?: boolean;
};

export type GuiAttachment = {
	id: string;
	issueId: string;
	name: string;
	/** Content-addressed blob name, served at /media/<fileName> */
	fileName: string;
	bytes: number;
	createdAt: number;
	canDelete: boolean;
};

export type GuiIssue = {
	isClosed: boolean;
	id: string;
	ref: string;
	title: string;
	description: string;
	/** Epoch ms, decoded from the issue's own ULID. */
	createdAt: number;
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
	ref: string;
	title: string;
	// The Closed board, and every board while the timeline is scrubbed.
	readonly: boolean;
	swimlanes: GuiSwimlane[];
};

// One line of a ticket's own event log, phrased and coloured server-side.
export type GuiIssueHistoryEntry = {
	id: string;
	t: number;
	action: string;
	label: string;
	actor: GuiUser;
};

export type GuiTimeTravelStatus = {
	mode: 'live' | 'scrub';
	asOfTime: number | null;
};

export type GuiState = {
	boards: GuiBoard[];
	tags: GuiTag[];
	contributors: GuiUser[];
	user: GuiUser;
	commentsByIssueId: Record<string, GuiComment[]>;
	attachmentsByIssueId: Record<string, GuiAttachment[]>;
	attachmentMaxKb?: number;
	timeTravel: GuiTimeTravelStatus;
};

export type GuiEventTimelineBucket = {t: number; count: number};

// Colour comes resolved from the server: deriving it here would pull in
// lib/utils/color.ts, and with it chalk, which the GUI bundle cannot take.
export type GuiEventIdentity = {id: string; name: string; color: string};

// `action` mirrors the server's EventAction, `label` its TUI-style phrasing.
// Both plain strings, so the client never imports the Node-side event model.
export type GuiEventTimelineEntry = {
	id: string;
	t: number;
	action: string;
	label: string;
	actor: GuiEventIdentity | null;
	tag: GuiEventIdentity | null;
	assignee: GuiEventIdentity | null;
};

export type GuiEventTimeline = {
	bucketMs: number;
	buckets: GuiEventTimelineBucket[];
	// Empty when the server capped the window; the scatter falls back to buckets.
	events: GuiEventTimelineEntry[];
	earliest: number;
	latest: number;
};

export type GuiCommitEntry = {
	sha: string;
	time: number;
	author: string;
	subject: string;
	linesChanged: number;
};
