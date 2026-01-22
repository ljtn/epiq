import {BoardItemTypes} from '../../board/model/board.model.js';
import {navigationState} from '../state/state.js';

export const CmdIntent = {
	None: 'none',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
} as const;

export const getCommandLineIntent = (
	command: string,
): (typeof CmdIntent)[keyof typeof CmdIntent] => {
	const actionContext = navigationState?.currentNode?.actionContext;
	if (!actionContext) return CmdIntent.None;

	switch (command) {
		case 'help':
		case 'he':
			return CmdIntent.ViewHelp;
		case 'add':
			switch (actionContext) {
				case BoardItemTypes.SWIMLANE:
					return CmdIntent.AddSwimlane;
				case BoardItemTypes.TICKET:
					return CmdIntent.AddTicket;
				default:
					return CmdIntent.None;
			}
		default:
			return CmdIntent.None;
	}
};
