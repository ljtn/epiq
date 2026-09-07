import {CmdKeyword} from '../../../../lib/command-line/cmd-keywords.js';
import {GuiContributor, GuiIssue, GuiTag} from '../gui-state.model';

// Either one of the TUI's keywords — both surfaces name the same thing the same
// way — or `gui:`-prefixed for what only a browser can do. A test holds the
// first half to `CmdKeywords`, so the two vocabularies cannot drift apart
// without saying so.
export type GuiCommandId = CmdKeyword | `gui:${string}`;

// What the second step of a two-stage command offers: a tag to apply, a person
// to assign. `color` is drawn as a swatch where the thing has one. `title`
// rather than `label` so an argument is `Matchable`, and one matcher ranks both
// steps.
export type CommandArgument = {
	id: string;
	title: string;
	hint?: string;
	color?: string;
};

export type CommandGroup = 'Ticket' | 'Board' | 'View' | 'History';

// Everything a command needs to decide whether it can run, and to run. Handlers
// are passed in rather than reached for, so the registry is a value the tests
// can build without a React tree.
export type CommandContext = {
	connected: boolean;
	// The board is checked out in the past, where the server refuses writes.
	scrubbing: boolean;
	issue: GuiIssue | null;
	tags: GuiTag[];
	contributors: GuiContributor[];
	handlers: CommandHandlers;
};

export type CommandHandlers = {
	createIssue: () => void;
	closeIssue: (issueId: string) => void;
	reopenIssue: (issueId: string) => void;
	addIssueTag: (issueId: string, tagName: string) => void;
	removeIssueTag: (issueId: string, tagId: string) => void;
	addIssueAssignee: (issueId: string, assigneeId: string) => void;
	removeIssueAssignee: (issueId: string, assigneeId: string) => void;
	commentOnIssue: (issueId: string) => void;
	copyRef: (ref: string) => void;
	sync: () => void;
	startTheatre: () => void;
	returnToLive: () => void;
	toggleLog: () => void;
	createSwimlane: () => void;
};

export type GuiCommand = {
	id: GuiCommandId;
	title: string;
	group: CommandGroup;
	// Words the matcher accepts besides the title: what somebody would type
	// looking for this, including the TUI keyword where the GUI title has
	// drifted from it.
	keywords?: string[];
	// Null when it can run, otherwise why not — which the row shows rather than
	// hiding, the way the TUI palette keeps unavailable commands listed.
	unavailable: (context: CommandContext) => string | null;
	// Only on the commands that take one. The palette pushes a second step over
	// what this returns.
	getArguments?: (context: CommandContext) => CommandArgument[];
	// For a command whose argument need not already exist — `:tag urgent` names
	// a tag into being in the TUI, and a board with no tags yet would otherwise
	// offer an empty list and no way forward. Null where the query is not a
	// usable one.
	freeTextArgument?: (query: string) => CommandArgument | null;
	run: (context: CommandContext, argument?: CommandArgument) => void;
};
