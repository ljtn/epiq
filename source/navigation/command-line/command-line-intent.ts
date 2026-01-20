import {BoardItemTypes} from '../../board/model/board.model.js';
import {navigationState} from '../state/state.js';

export const CommandLineIntent = {
	None: 'none',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
} as const;

export const getCommandLineIntent = (
	input: string,
): (typeof CommandLineIntent)[keyof typeof CommandLineIntent] => {
	const actionContext = navigationState?.currentNode?.actionContext;
	if (!actionContext) return CommandLineIntent.None;

	switch (input) {
		case 'help':
		case 'he':
			return CommandLineIntent.ViewHelp;
		case 'add':
			switch (actionContext) {
				case BoardItemTypes.SWIMLANE:
					return CommandLineIntent.AddSwimlane;
				case BoardItemTypes.TICKET:
					return CommandLineIntent.AddTicket;
				default:
					return CommandLineIntent.None;
			}
		default:
			return CommandLineIntent.None;
	}
};
