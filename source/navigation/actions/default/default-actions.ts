import {CmdIntent} from '../../command-line/command-line-sequence-intent.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {updateCommandLineInput} from '../../state/command-line.state.js';
import {appState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {
	enterChildNode,
	exitToParentNode,
	navigateToNextContainer,
	navigateToNextItem,
	navigateToPreviousContainer,
	navigateToPreviousItem,
} from './default-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	{
		intent: Intent.ToggleCommandLine,
		mode: Mode.DEFAULT,
		description: '[:] Toggle command line',
		action: () => patchState({mode: Mode.COMMAND_LINE}),
	},
	{
		intent: Intent.ToggleCommandLine,
		mode: Mode.COMMAND_LINE,
		description: '[ESC] Toggle command line',
		action: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: Intent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER] Confirm/Enter context',
		action: enterChildNode,
	},
	{
		intent: Intent.Exit,
		mode: Mode.DEFAULT,
		description: '[ESC/Q] Exit application',
		action: exitToParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROWS/HJKL] Navigate',
	},

	{
		intent: Intent.NavPreviousItem,
		mode: Mode.DEFAULT,
		action: navigateToPreviousItem,
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.DEFAULT,
		action: navigateToNextItem,
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: navigateToPreviousContainer,
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: navigateToNextContainer,
	},
	{
		intent: Intent.Edit,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			updateCommandLineInput(
				() => `${CmdIntent.Rename} ${appState.currentNode?.name}`,
			);
		},
	},
];
