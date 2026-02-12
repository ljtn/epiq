import {contextMap} from '../../board/model/context.model.js';
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
	const actionContext = appState?.currentNode?.context;
	if (!actionContext) return CmdIntent.None;
	switch (command) {
		case 'help':
			return CmdIntent.ViewHelp;
		case 'rename':
			return CmdIntent.Rename;
		case 'a':
		case 'add':
			switch (actionContext) {
				case contextMap.BOARD:
					return CmdIntent.AddSwimlane;
				case contextMap.SWIMLANE:
					return CmdIntent.AddTicket;
				default:
					return CmdIntent.None;
			}
		default:
			return CmdIntent.None;
	}
};
