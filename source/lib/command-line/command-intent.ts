import {getState} from '../state/state.js';
import {CommandIntent} from './command-meta.js';
import {CmdKeywords} from './cmd-keywords.js';

export const getCommandIntent = (command: string): CommandIntent => {
	const {context} = getState().contextNode;

	if (!context) return CmdIntent.None;

	switch (command) {
		case CmdKeywords.EXIT:
			return CmdIntent.Exit;

		case CmdKeywords.EXPORT:
			return CmdIntent.Export;

		case CmdKeywords.COFFEE:
			return CmdIntent.Coffee;

		case CmdKeywords.INIT:
			return CmdIntent.Init;

		case CmdKeywords.DELETE:
			return CmdIntent.Delete;

		case CmdKeywords.EDIT:
			return CmdIntent.Edit;

		case CmdKeywords.HELP:
			return CmdIntent.ViewHelp;

		case CmdKeywords.RE_OPEN_ISSUE:
			return CmdIntent.ReopenIssue;

		case CmdKeywords.CLOSE_ISSUE:
			return CmdIntent.CloseIssue;

		case CmdKeywords.TAG:
			return CmdIntent.TagTicket;

		case CmdKeywords.UNTAG:
			return CmdIntent.UntagTicket;

		case CmdKeywords.ASSIGN:
			return CmdIntent.AssignUserToTicket;

		case CmdKeywords.UNASSIGN:
			return CmdIntent.UnassignUserFromTicket;

		case CmdKeywords.NEW:
			return CmdIntent.NewItem;

		case CmdKeywords.FILTER:
			return CmdIntent.Filter;

		case CmdKeywords.MOVE:
			return CmdIntent.Move;

		case CmdKeywords.PEEK:
			return CmdIntent.Peek;

		case CmdKeywords.CONFIG:
			return CmdIntent.Config;

		// Git
		case CmdKeywords.SYNC:
			return CmdIntent.Sync;

		default:
			return CmdIntent.None;
	}
};
export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	Exit: 'exit',
	Init: 'init',
	None: 'none',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Edit: 'edit',
	Delete: 'delete',

	Filter: 'filter',
	Move: 'move',
	Peek: 'peek',

	// Settings
	Config: 'config',

	// Add
	NewItem: 'add-new-item',

	TagTicket: 'ticket-tag',
	UntagTicket: 'ticket-untag',
	AssignUserToTicket: 'ticket-assign-user',
	UnassignUserFromTicket: 'ticket-unassign-user',
	CloseIssue: 'close-issue',
	ReopenIssue: 're-open-issue',

	// Git
	Sync: 'sync',

	Export: 'export',
	Coffee: 'coffee',
} as const;
