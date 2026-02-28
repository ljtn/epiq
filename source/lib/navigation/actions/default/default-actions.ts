import {CmdIntent} from '../../command-line/command-line-sequence-intent.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {appState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigator} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	{
		intent: Intent.InitCommandLine,
		mode: Mode.DEFAULT,
		description: '[:] Toggle command line',
		action: () => patchState({mode: Mode.COMMAND_LINE}),
	},
	{
		intent: Intent.Confirm,
		mode: Mode.DEFAULT,
		description: '[ENTER] Confirm/Enter context',
		action: navigator.enterChildNode,
	},
	{
		intent: Intent.Exit,
		mode: Mode.DEFAULT,
		description: '[ESC/Q] Exit application',
		action: navigator.enterParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROWS/HJKL] Navigate',
	},

	{
		intent: Intent.NavPreviousItem,
		mode: Mode.DEFAULT,
		action: navigator.navigateToPreviousItem,
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.DEFAULT,
		action: navigator.navigateToNextItem,
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: navigator.navigateToPreviousContainer,
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: navigator.navigateToNextContainer,
	},
	{
		intent: Intent.Edit,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(
				() => `${CmdIntent.Rename} ${appState.currentNode?.fields['title']}`,
			);
		},
	},
];
