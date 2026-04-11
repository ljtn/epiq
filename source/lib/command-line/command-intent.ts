import {getState} from '../state/state.js';
import {CmdIntent} from './command-meta.js';
import {CmdKeywords} from './command-types.js';

export const getCommandIntent = (
	command: string,
): (typeof CmdIntent)[keyof typeof CmdIntent] => {
	const {context} = getState()?.currentNode;
	if (!context) return CmdIntent.None;
	switch (command) {
		case CmdKeywords.DELETE:
			return CmdIntent.Delete;
		case CmdKeywords.HELP:
			return CmdIntent.ViewHelp;
		case CmdKeywords.SET_EDITOR:
			return CmdIntent.SetEditor;
		case CmdKeywords.TAG:
			return CmdIntent.TagTicket;
		case CmdKeywords.ASSIGN:
			return CmdIntent.AssignUserToTicket;
		case CmdKeywords.SET_VIEW:
			return CmdIntent.SetView;
		case CmdKeywords.RENAME:
			return CmdIntent.Rename;
		case CmdKeywords.NEW:
			return CmdIntent.NewItem;
		default:
			return CmdIntent.None;
	}
};
