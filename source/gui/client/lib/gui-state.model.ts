import type {LaneRule} from '../../../lib/model/lane-rule.model.js';

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
	/** Epoch ms it last arrived in the swimlane it is in. */
	enteredLaneAt: number;
	/** Epoch ms anything last happened to it, by anyone. Display only. */
	lastEventAt?: number;
	readonly: boolean;
	tags: GuiTag[];
	assignees: GuiUser[];
	/** The goal it belongs to, as it reads now. */
	goal?: GuiGoalRef;
	/** Every board it has lived on, this one included. */
	boardIds: string[];
};

export type GuiGoalRef = {id: string; name: string; color: string};

/** A goal, and how far along its tickets are, on every board. */
export type GuiGoal = GuiGoalRef & {done: number; total: number};

/** A goal a board shows, and which of its tickets that board shows. */
export type GuiBoardGoal = GuiGoal & {members: {id: string; done: boolean}[]};

export type GuiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	issues: GuiIssue[];
	// The lane's conventions, as markdown; absent when it has none.
	description?: string;
	// What standing in the lane means for its tickets; absent when it has none.
	rules?: LaneRule[];
	// Whether its open tickets count as done: by its rule, or by its name.
	countsDone: boolean;
	// Called Done, which counts whatever its rules say.
	doneByName: boolean;
};

export type GuiBoard = {
	id: string;
	ref: string;
	title: string;
	// The Closed board, and every board while the timeline is scrubbed.
	readonly: boolean;
	swimlanes: GuiSwimlane[];
	goals: GuiBoardGoal[];
	// The board's conventions, as markdown; absent when it has none.
	description?: string;
};

// One line of a ticket's own event log, phrased and coloured server-side.
export type GuiIssueHistoryEntry = {
	id: string;
	t: number;
	action: string;
	label: string;
	actor: GuiUser;
	// Which lane a move put the ticket in — moves only. What the Stats tab
	// counts to say a ticket has gone backwards.
	parentId?: string;
};

export type GuiTimeTravelStatus = {
	mode: 'live' | 'scrub';
	asOfTime: number | null;
};

export type GuiState = {
	boards: GuiBoard[];
	tags: GuiTag[];
	goals: GuiGoal[];
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
	// The ticket the event happened to, for the board's window filter. Null for
	// board- and swimlane-level events.
	issue: string | null;
	// The comment the event happened to, where it happened to one, so a log
	// line about a comment can lead to the comment and not just its tab.
	target: string | null;
	// The event's board. Null means every board (a contributor claim), so a
	// board filter keeps the nulls.
	board: string | null;
	// The ticket's lane after the event, and the one a move took it out of.
	// Null under no ticket; `laneBefore` null where it stayed put.
	lane: string | null;
	laneBefore: string | null;
};

export type GuiEventTimeline = {
	bucketMs: number;
	buckets: GuiEventTimelineBucket[];
	// The window held more events than the server lists: `events` is empty and
	// the buckets are all there is.
	capped: boolean;
	// Empty when the server capped the window; the scatter falls back to buckets.
	events: GuiEventTimelineEntry[];
	// The lane of every ticket open as the window begins, by id, so the flow
	// chart runs a line across a stretch nothing happened in.
	lanesAtStart: Record<string, string>;
	// Every swimlane the log ever created, under its last known name, for one
	// the board has since deleted.
	laneNames: Record<string, string>;
	// The lane a close moves a ticket into.
	closedLane: string;
	earliest: number;
	latest: number;
};

// Mirrored rather than imported: `Identity` lives beside `getStringColor`,
// which is Node-side, and the GUI build refuses a client import of it.
export type GuiIdentity = {id: string; name: string; color: string};

/** A commit's author, and whether it is a board identity or a raw git name. */
export type GuiCommitAuthor = GuiIdentity & {resolved: boolean};

export type GuiCommitEntry = {
	sha: string;
	/** The registered repo it is in, by id; absent for the board's own repo. */
	repo?: string;
	time: number;
	/** The raw git author name. Shown only where nothing has claimed the address. */
	author: string;
	authorEmail: string;
	/** Who the author is on this board; resolved on the server from the event log. */
	authorIdentity?: GuiCommitAuthor;
	subject: string;
	/** Refs named by `Epiq-Ref:` lines in the body. */
	refs?: string[];
	linesChanged: number;
	insertions: number;
	deletions: number;
};

// A connecting line in the rail: this matched commit's predecessor in the
// unfiltered history is also matched.
export type GuiRefCommitEntry = GuiCommitEntry & {
	precedingSha: string | null;
	/** The message below the subject, where there is one. */
	body?: string;
	/** On a goal's list: the refs of its tickets this commit carries. */
	tickets?: string[];
};

export type GuiCommitDiffFile = {
	path: string;
	before: string;
	after: string;
	insertions: number;
	deletions: number;
	// A file git will not diff; both sides arrive empty. Optional, since an older
	// server may have sent the reply.
	isBinary?: boolean;
};

export type GuiCommitDiff = {
	sha: string;
	repo?: string;
	files: GuiCommitDiffFile[];
	/** The message below the subject, where there is one. */
	body?: string;
};

// A file in the compacted diff, carrying the commit a comment on it anchors
// to: the last of the ticket's commits to touch it. See SquashedDiffFile.
export type GuiSquashedDiffFile = GuiCommitDiffFile & {
	sha: string;
	repo?: string;
};

/** Another repo whose commits count as the board's, and this machine's clone of it. */
// The board's own repo: never registered, read from the checkout itself.
export type GuiOwnRepo = {
	label: string;
	/** Its origin, or null when the checkout has none. */
	url: string | null;
	path: string;
};

export type GuiRepo = {
	id: string;
	label: string;
	url: string;
	branches: 'default' | 'all';
	/** `board`, `all`, or a `YYYY-MM-DD` date. */
	since: string;
	cloned: boolean;
	/** Connected past the board's limit: listed, never fetched. */
	overLimit: boolean;
	/** The clone's size, or null where none has landed. */
	bytes: number | null;
	fetchedAt: number | null;
	error: string | null;
};

export type GuiRepoList = {
	repos: GuiRepo[];
	/** What this board's clones take on this machine. */
	claimedBytes: number;
	/** How many repos the board fetches; the rest are listed, never fetched. */
	limit: number;
	/** Whether a local file:/// repo may be connected: tests only. */
	allowLocal: boolean;
};

// A repo cloned into a stage and described, before anything is connected.
// Mirrors RepoPreview in source/lib/commits/commit-repo-preflight.ts.
export type GuiRepoPreview = {
	repo: {
		id: string;
		label: string;
		url: string;
		branches: 'default' | 'all';
		since: string;
	};
	host: string;
	defaultBranch: string | null;
	latest: {subject: string; author: string; date: string} | null;
	commits: number;
	ticketCommits: number;
	bytes: number;
	contributors: number;
	claimedBytes: number;
	overLimit: boolean;
	expiresAt: number;
};

// The Code tab's compacted view: every commit on the ticket as one diff.
export type GuiSquashedDiff = {
	ref: string;
	from: string;
	to: string;
	commits: number;
	files: GuiSquashedDiffFile[];
	// False when another ticket's commit landed between this one's.
	// `overlappingPaths` names the files where that shows.
	contiguous: boolean;
	overlappingPaths: string[];
};
