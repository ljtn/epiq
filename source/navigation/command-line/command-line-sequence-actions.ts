import {
	addSwimlaneAction,
	addTicketAction,
} from '../actions/add-item/add-item-actions.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {patchState} from '../state/state.js';
import {CommandLineSequenceIntent} from './command-line-sequence-intent.js';

export const commandLineSequenceActions: CommandLineActionEntry[] = [
	{
		intent: CommandLineSequenceIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({
				mode: Mode.HELP,
			});
		},
	},
	{
		intent: CommandLineSequenceIntent.AddSwimlane,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addSwimlaneAction(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CommandLineSequenceIntent.AddTicket,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addTicketAction(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
];
