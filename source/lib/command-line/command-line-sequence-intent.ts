import {NavNodeCtx} from '../model/context.model.js';
import {getState} from '../state/state.js';

export const CmdIntent = {
	None: 'none',
	AddBoard: 'add-board',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
	Rename: 'rename',
} as const;

export const CmdKeywords = {
	HELP: 'help',
	RENAME: 'rename',
	ADD: 'add',
} as const;

export const getCommandIntent = (
	command: string,
): (typeof CmdIntent)[keyof typeof CmdIntent] => {
	const {context} = getState()?.currentNode;
	if (!context) return CmdIntent.None;
	switch (command) {
		case CmdKeywords.HELP:
			return CmdIntent.ViewHelp;
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
				default:
					return CmdIntent.None;
			}
		default:
			return CmdIntent.None;
	}
};
