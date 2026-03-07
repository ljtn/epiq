import {NavNodeCtx} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {CmdIntent, CmdKeywords} from './cmd-utils.js';

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
		case CmdKeywords.VIEW:
			return CmdIntent.SetView;
		case CmdKeywords.RENAME:
			return CmdIntent.Rename;
		case CmdKeywords.ADD:
			switch (context) {
				case NavNodeCtx.WORKSPACE:
					return CmdIntent.AddBoard;
				case NavNodeCtx.BOARD:
					return CmdIntent.AddSwimlane;
				case NavNodeCtx.SWIMLANE:
					return CmdIntent.AddTicket;
				case NavNodeCtx.FIELD_LIST:
					return CmdIntent.AddListItem;
				default:
					return CmdIntent.None;
			}
		default:
			return CmdIntent.None;
	}
};
