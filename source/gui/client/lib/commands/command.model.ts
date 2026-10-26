import {CmdKeyword} from '../../../../lib/command-line/cmd-keywords.js';
import {GuiContributor, GuiGoal, GuiIssue, GuiTag} from '../gui-state.model';

// A TUI keyword, or `gui:`-prefixed for what only a browser can do. A test
// holds the first half to `CmdKeywords`.
export type GuiCommandId = CmdKeyword | `gui:${string}`;

// The second step of a two-stage command: a tag to apply, a person to assign.
// `title` so it is `Matchable` like a command.
export type CommandArgument = {
	id: string;
	title: string;
	// Extra words this can be found by — a ticket's ref, which is what somebody
	// types when they already know it.
	keywords?: string[];
	hint?: string;
	color?: string;
};

export type CommandGroup = 'Ticket' | 'Board' | 'View' | 'History';

// Everything a command needs to decide whether it can run, and to run.
// One ticket anywhere in the project, flattened for the search command.
export type SearchableTicket = {
	id: string;
	ref: string;
	title: string;
	boardTitle: string;
	// What its route is keyed by: a search can land on another board.
	boardRef: string;
};

export type CommandContext = {
	connected: boolean;
	// The board is checked out in the past, where the server refuses writes.
	scrubbing: boolean;
	issue: GuiIssue | null;
	// The board on screen, which is the one a board command acts on.
	board: {id: string; title: string; readonly: boolean} | null;
	tags: GuiTag[];
	goals: GuiGoal[];
	// Every ticket in every board, for the project-wide search.
	tickets: SearchableTicket[];
	contributors: GuiContributor[];
	handlers: CommandHandlers;
};

export type CommandHandlers = {
	createIssue: () => void;
	openIssue: (issueId: string, boardRef: string) => void;
	closeIssue: (issueId: string) => void;
	reopenIssue: (issueId: string) => void;
	addIssueTag: (issueId: string, tagName: string) => void;
	removeIssueTag: (issueId: string, tagId: string) => void;
	// A goal's id, or the name of one to find or make; null takes it out.
	setIssueGoal: (issueId: string, goal: string | null) => void;
	manageGoals: () => void;
	addIssueAssignee: (issueId: string, assigneeId: string) => void;
	removeIssueAssignee: (issueId: string, assigneeId: string) => void;
	commentOnIssue: (issueId: string) => void;
	copyRef: (ref: string) => void;
	sync: () => void;
	startTheatre: () => void;
	returnToLive: () => void;
	toggleLog: () => void;
	toggleCardDensity: () => void;
	toggleDenseTitleLines: () => void;
	createSwimlane: () => void;
	createBoard: () => void;
	renameBoard: () => void;
	openBoardDetails: () => void;
	openRepos: () => void;
	openSettings: () => void;
};

export type GuiCommand = {
	id: GuiCommandId;
	title: string;
	group: CommandGroup;
	// Words the matcher accepts besides the title, including the TUI keyword.
	keywords?: string[];
	// Null when it can run, otherwise why not — which the row shows rather than
	// hiding, the way the TUI palette keeps unavailable commands listed.
	unavailable: (context: CommandContext) => string | null;
	// Only on the commands that take one. The palette pushes a second step over
	// what this returns.
	getArguments?: (context: CommandContext) => CommandArgument[];
	// For an argument that need not exist yet, like a new tag. Null where the
	// query is not usable.
	freeTextArgument?: (query: string) => CommandArgument | null;
	run: (context: CommandContext, argument?: CommandArgument) => void;
};
