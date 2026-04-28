import {getState} from '../state/state.js';
import {CmdIntent, CommandIntent} from './command-meta.js';
import {CmdKeywords} from './command-types.js';

export const getCommandIntent = (command: string): CommandIntent => {
	const {context} = getState()?.currentNode;
	if (!context) return CmdIntent.None;
	switch (command) {
		case CmdKeywords.INIT:
			return CmdIntent.Init;
		case CmdKeywords.DELETE:
			return CmdIntent.Delete;
		case CmdKeywords.SET_DESCRIPTION:
			return CmdIntent.Edit;
		case CmdKeywords.HELP:
			return CmdIntent.ViewHelp;
		case CmdKeywords.RE_OPEN_ISSUE:
			return CmdIntent.ReopenIssue;
		case CmdKeywords.CLOSE_ISSUE:
			return CmdIntent.CloseIssue;
		case CmdKeywords.TAG:
			return CmdIntent.TagTicket;
		case CmdKeywords.ASSIGN:
			return CmdIntent.AssignUserToTicket;
		case CmdKeywords.RENAME:
			return CmdIntent.Rename;
		case CmdKeywords.NEW:
			return CmdIntent.NewItem;
		case CmdKeywords.FILTER:
			return CmdIntent.Filter;
		case CmdKeywords.MOVE:
			return CmdIntent.Move;
		case CmdKeywords.PEEK:
			return CmdIntent.Peek;
		// Settings
		case CmdKeywords.SET_USERNAME:
			return CmdIntent.SetUserName;
		case CmdKeywords.SET_EDITOR:
			return CmdIntent.SetEditor;
		case CmdKeywords.SET_VIEW:
			return CmdIntent.SetView;

		// Git
		case CmdKeywords.SYNC:
			return CmdIntent.Sync;
		default:
			return CmdIntent.None;
	}
};
