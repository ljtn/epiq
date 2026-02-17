import {
	addSwimlaneAction,
	addTicketAction,
} from '../actions/add-item/add-item-actions.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {getCmdArg} from '../state/cmd.state.js';
import {appState, patchState, updateState} from '../state/state.js';
import {CmdIntent} from './command-line-sequence-intent.js';

export const commands: CommandLineActionEntry[] = [
	{
		intent: CmdIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => patchState({mode: Mode.HELP}),
	},
	{
		intent: CmdIntent.AddSwimlane,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addSwimlaneAction(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.AddTicket,
		mode: Mode.COMMAND_LINE,
		action: (...args) => {
			addTicketAction(...args);
			patchState({mode: Mode.DEFAULT});
		},
	},
	{
		intent: CmdIntent.Rename,
		mode: Mode.COMMAND_LINE,
		action: () => {
			updateState(s => {
				// Update board on file
				const newBoard = appState.rootNode!;
				const currentId = s.currentNode?.id;
				if (!currentId) return s;
				const findItemInBoard = (item: any, id: string) => {
					if (item.id === id) return item;
					return (
						item.children.find((child: any) => findItemInBoard(child, id)) ||
						undefined
					);
				};
				const newName = getCmdArg();
				const itemInBoard = findItemInBoard(newBoard, currentId);
				if (!itemInBoard) return s;
				itemInBoard.name = newName;
				return {
					...s,
					mode: Mode.DEFAULT,
					rootNode: newBoard,
					currentNode: itemInBoard,
				};
			});
		},
	},
];
