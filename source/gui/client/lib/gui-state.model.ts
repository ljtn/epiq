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
	readonly: boolean;
	tags: GuiTag[];
	assignees: GuiUser[];
	/** Every board it has lived on, this one included. */
	boardIds: string[];
};

export type GuiSwimlane = {
	id: string;
	title: string;
	readonly: boolean;
	issues: GuiIssue[];
};

export type GuiBoard = {
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
	// The board the event belongs to. Null means *every* board rather than none
	// — a contributor claim decides who the commits on all of them belong to —
	// so a reader filtering by board keeps the nulls.
	//
	// Carried because the client cannot otherwise tell a foreign line from a
	// local one: under the All-boards toggle the window holds both, and a
	// ticket's route is built from the board on screen.
	board: string | null;
	// The swimlane that ticket is in once the event has happened, and the one a
	// move, close or reopen took it out of. Null where the event is under no
	// ticket, and `laneBefore` null where the ticket stayed put.
	lane: string | null;
	laneBefore: string | null;
};

export type GuiEventTimeline = {
	bucketMs: number;
	buckets: GuiEventTimelineBucket[];
	// The window held more events than the server will list, so `events` is
	// empty and the buckets are all there is. Distinct from a window that was
	// simply quiet, which the empty array alone cannot say.
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
	time: number;
	/** The raw git author name. Shown only where nothing has claimed the address. */
	author: string;
	authorEmail: string;
	/**
	 * Who the author is on this board. Resolved on the server, because matching
	 * needs the event log the client cannot import.
	 */
	authorIdentity?: GuiCommitAuthor;
	subject: string;
	linesChanged: number;
	insertions: number;
	deletions: number;
};

// The Code tab's shape: a matched commit whose immediate predecessor in
// the *unfiltered* history is also a matched commit (no other ticket's
// commit sits between them) — that's what a connecting line in the rail means.
export type GuiRefCommitEntry = GuiCommitEntry & {precedingSha: string | null};

export type GuiCommitDiffFile = {
	path: string;
	before: string;
	after: string;
	insertions: number;
	deletions: number;
	// A file git will not diff. Both sides arrive empty — see CommitDiffFile —
	// so a view that draws this one anyway draws nothing, and a view that drew
	// it before this field existed drew the bytes.
	//
	// Optional because a reply is not always this build's: the log window and a
	// tab left open across an upgrade both read state a older server sent.
	isBinary?: boolean;
};

export type GuiCommitDiff = {
	sha: string;
	files: GuiCommitDiffFile[];
};

// A file in the compacted diff, carrying the commit a comment on it anchors
// to: the last of the ticket's commits to touch it. See SquashedDiffFile.
export type GuiSquashedDiffFile = GuiCommitDiffFile & {sha: string};

// The Code tab's compacted view: every commit on the ticket as one diff.
export type GuiSquashedDiff = {
	ref: string;
	from: string;
	to: string;
	commits: number;
	files: GuiSquashedDiffFile[];
	// False when another ticket's commit landed between two of this one's, so
	// the range compared is not this ticket's work alone. `overlappingPaths`
	// then names the files where that actually shows; empty means the
	// interleaving missed every file this ticket touched.
	contiguous: boolean;
	overlappingPaths: string[];
};
