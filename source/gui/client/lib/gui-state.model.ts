export type GuiTag = {id: string; name: string; color: string};
export type GuiUser = {id: string; name: string; color: string};

// Who can be assigned, as opposed to GuiState.contributors, which is only the
// registry. Derived server-side (see getBoardContributors) so every surface
// agrees on who "me" is and who has actually worked on the board.
export type GuiContributor = GuiUser & {
	isSelf: boolean;
	// Board-scoped: they have not worked on the board being viewed. Drives the
	// "external" marker in the assignee picker.
	isExternal: boolean;
	// Their name has already been cleared, so there is nothing left to redact.
	isRedacted: boolean;
	// Workspace-wide: their name appears in the event log somewhere, which is
	// what makes a name un-clearable. Distinct from `isExternal` — someone can
	// be external to this board and still be an author on another.
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
	swimlanes: GuiSwimlane[];
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

export type GuiEventTimeline = {
	bucketMs: number;
	buckets: GuiEventTimelineBucket[];
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
