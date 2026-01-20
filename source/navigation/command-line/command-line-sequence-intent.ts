import {BoardItemTypes} from '../../board/model/board.model.js';
import {navigationState} from '../state/state.js';

export const CommandLineSequenceIntent = {
	None: 'none',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	ViewHelp: 'view-help',
} as const;

export const getCommandLineIntent = (
	command: string,
): (typeof CommandLineSequenceIntent)[keyof typeof CommandLineSequenceIntent] => {
	const actionContext = navigationState?.currentNode?.actionContext;
	if (!actionContext) return CommandLineSequenceIntent.None;

	switch (command) {
		case 'help':
		case 'he':
			return CommandLineSequenceIntent.ViewHelp;
		case 'add':
			switch (actionContext) {
				case BoardItemTypes.SWIMLANE:
					return CommandLineSequenceIntent.AddSwimlane;
				case BoardItemTypes.TICKET:
					return CommandLineSequenceIntent.AddTicket;
				default:
					return CommandLineSequenceIntent.None;
			}
		default:
			return CommandLineSequenceIntent.None;
	}
};
