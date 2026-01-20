import {
	addSwimlaneAction,
	addTicketAction,
} from '../actions/add-item/add-item-actions.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {patchState} from '../state/state.js';
import {CommandLineIntent} from './command-line-intent.js';

export const commandLineActions: CommandLineActionEntry[] = [
	{
		intent: CommandLineIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({
				mode: Mode.HELP,
				commandLineInput: '',
			});
		},
	},
	{
		intent: CommandLineIntent.AddSwimlane,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addSwimlaneAction(...args);
			patchState({commandLineInput: '', mode: Mode.DEFAULT});
		},
	},
	{
		intent: CommandLineIntent.AddTicket,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addTicketAction(...args);
			patchState({commandLineInput: '', mode: Mode.DEFAULT});
		},
	},
];
