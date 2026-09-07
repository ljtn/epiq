import {CmdKeywords} from '../../../../lib/command-line/cmd-keywords.js';
import {CommandContext, GuiCommand} from './command.model';

// The reasons a command cannot run, written once: every command that needs a
// ticket says the same thing about not having one.
const needsTicket = (context: CommandContext): string | null =>
	context.issue ? null : 'Open a ticket first';

const needsWrite = (context: CommandContext): string | null => {
	if (!context.connected) return 'Not connected';
	// The server refuses every mutation from a board checked out in the past, so
	// the palette says so rather than firing into a 409.
	if (context.scrubbing) return 'Read-only while viewing history';

	return null;
};

const needsWritableTicket = (context: CommandContext): string | null =>
	needsWrite(context) ?? needsTicket(context);

/**
 * Every command the GUI offers, in the order an empty palette lists them.
 *
 * Named after the TUI's keywords wherever the two surfaces mean the same thing,
 * so what somebody learned in one works in the other. `gui:` ids are the ones a
 * terminal has no equivalent for; the TUI-only commands (`init`, `config`,
 * `exit`, `move`) are simply absent, since a browser has nothing to point them
 * at.
 *
 * Built from handlers rather than reaching for them, so the whole registry is a
 * value a test can construct.
 */
export const buildCommandRegistry = (): GuiCommand[] => [
	{
		id: CmdKeywords.NEW,
		title: 'New ticket',
		group: 'Board',
		keywords: ['create', 'add', 'issue'],
		unavailable: needsWrite,
		run: context => context.handlers.createIssue(),
	},
	{
		id: 'gui:swimlane',
		title: 'New swimlane',
		group: 'Board',
		keywords: ['column', 'lane', 'create'],
		unavailable: needsWrite,
		run: context => context.handlers.createSwimlane(),
	},
	{
		id: CmdKeywords.COMMENT,
		title: 'Comment on ticket',
		group: 'Ticket',
		unavailable: needsWritableTicket,
		run: context => {
			if (context.issue) context.handlers.commentOnIssue(context.issue.id);
		},
	},
	{
		id: CmdKeywords.TAG,
		title: 'Add a tag',
		group: 'Ticket',
		keywords: ['label'],
		unavailable: needsWritableTicket,
		// Only tags the ticket does not already carry: the second step should
		// offer what it can actually do.
		getArguments: context => {
			const held = new Set(context.issue?.tags.map(tag => tag.id));

			return context.tags
				.filter(tag => !held.has(tag.id))
				.map(tag => ({id: tag.id, title: tag.name, color: tag.color}));
		},
		// The mutation takes a name and creates the tag if it is new, which is
		// what makes `:tag urgent` work on a board that has never had one.
		freeTextArgument: query =>
			query.trim() ? {id: `new:${query.trim()}`, title: query.trim()} : null,
		run: (context, argument) => {
			if (context.issue && argument) {
				context.handlers.addIssueTag(context.issue.id, argument.title);
			}
		},
	},
	{
		id: CmdKeywords.UNTAG,
		title: 'Remove a tag',
		group: 'Ticket',
		keywords: ['label'],
		unavailable: context =>
			needsWritableTicket(context) ??
			(context.issue?.tags.length ? null : 'This ticket has no tags'),
		getArguments: context =>
			(context.issue?.tags ?? []).map(tag => ({
				id: tag.id,
				title: tag.name,
				color: tag.color,
			})),
		run: (context, argument) => {
			if (context.issue && argument) {
				context.handlers.removeIssueTag(context.issue.id, argument.id);
			}
		},
	},
	{
		id: CmdKeywords.ASSIGN,
		title: 'Assign someone',
		group: 'Ticket',
		keywords: ['owner', 'who'],
		unavailable: needsWritableTicket,
		getArguments: context => {
			const assigned = new Set(context.issue?.assignees.map(user => user.id));

			return context.contributors
				.filter(person => !person.isRemoved && !assigned.has(person.id))
				.map(person => ({
					id: person.id,
					title: person.name,
					color: person.color,
					hint: person.isSelf ? 'you' : undefined,
				}));
		},
		run: (context, argument) => {
			if (context.issue && argument) {
				context.handlers.addIssueAssignee(context.issue.id, argument.id);
			}
		},
	},
	{
		id: CmdKeywords.UNASSIGN,
		title: 'Unassign someone',
		group: 'Ticket',
		unavailable: context =>
			needsWritableTicket(context) ??
			(context.issue?.assignees.length ? null : 'Nobody is assigned'),
		getArguments: context =>
			(context.issue?.assignees ?? []).map(user => ({
				id: user.id,
				title: user.name,
				color: user.color,
			})),
		run: (context, argument) => {
			if (context.issue && argument) {
				context.handlers.removeIssueAssignee(context.issue.id, argument.id);
			}
		},
	},
	{
		id: CmdKeywords.CLOSE_ISSUE,
		title: 'Close ticket',
		group: 'Ticket',
		keywords: ['done', 'resolve'],
		unavailable: context =>
			needsWritableTicket(context) ??
			(context.issue?.isClosed ? 'Already closed' : null),
		run: context => {
			if (context.issue) context.handlers.closeIssue(context.issue.id);
		},
	},
	{
		id: CmdKeywords.RE_OPEN_ISSUE,
		title: 'Reopen ticket',
		group: 'Ticket',
		unavailable: context =>
			needsWritableTicket(context) ??
			(context.issue?.isClosed ? null : 'This ticket is open'),
		run: context => {
			if (context.issue) context.handlers.reopenIssue(context.issue.id);
		},
	},
	{
		// The TUI yanks a node's reference to the clipboard; the GUI's equivalent
		// of "the thing you would paste" is the ticket ref.
		id: CmdKeywords.YANK,
		title: 'Copy ticket reference',
		group: 'Ticket',
		keywords: ['yank', 'clipboard', 'ref'],
		unavailable: needsTicket,
		run: context => {
			if (context.issue) context.handlers.copyRef(context.issue.ref);
		},
	},
	{
		id: CmdKeywords.SYNC,
		title: 'Sync with the remote',
		group: 'Board',
		keywords: ['push', 'pull', 'git'],
		unavailable: context => (context.connected ? null : 'Not connected'),
		run: context => context.handlers.sync(),
	},
	{
		// The TUI replays the log into the terminal; here it is the player that
		// already exists, over the window the scrubber is showing.
		id: CmdKeywords.REPLAY,
		title: 'Play the board back',
		group: 'History',
		keywords: ['replay', 'theatre', 'movie'],
		unavailable: context => (context.connected ? null : 'Not connected'),
		run: context => context.handlers.startTheatre(),
	},
	{
		id: 'gui:live',
		title: 'Return to live',
		group: 'History',
		keywords: ['now', 'present', 'exit history'],
		unavailable: context =>
			context.scrubbing ? null : 'The board is already live',
		run: context => context.handlers.returnToLive(),
	},
	{
		id: 'gui:log',
		title: 'Toggle the event log',
		group: 'View',
		keywords: ['history', 'panel'],
		unavailable: () => null,
		run: context => context.handlers.toggleLog(),
	},
];

// Unavailable last, available first — the TUI palette's rule, kept because
// hiding a command teaches nobody that it exists.
export const commandRank =
	(context: CommandContext) =>
	(command: GuiCommand): number =>
		command.unavailable(context) === null ? 0 : 1;
