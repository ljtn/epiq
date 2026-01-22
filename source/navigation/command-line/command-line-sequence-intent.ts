import {BoardItemTypes} from '../../board/model/board.model.js';
import {appState} from '../state/state.js';

export const CmdIntent = {
	None: 'none',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
	Rename: 'rename',
} as const;

export const getCommandIntent = (
	command: string,
): (typeof CmdIntent)[keyof typeof CmdIntent] => {
	const actionContext = appState?.currentNode?.actionContext;
	if (!actionContext) return CmdIntent.None;

	switch (command) {
		case 'help':
		case 'he':
			return CmdIntent.ViewHelp;
		case 'rename':
			return CmdIntent.Rename;
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
