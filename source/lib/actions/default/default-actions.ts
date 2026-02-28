import {CmdIntent} from '../../navigation/command-line/command-line-sequence-intent.js';
import {ActionEntry, Mode} from '../../navigation/model/action-map.model.js';
import {setCmdInput} from '../../navigation/state/cmd.state.js';
import {appState, patchState} from '../../navigation/state/state.js';
import {Intent} from '../../navigation/utils/key-intent.js';
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
			if (appState.currentNode.context === 'TICKET') {
				// Use editor
				logger.debug(CmdIntent.Rename, appState.currentNode.fields.title);
			} else {
				// Use command line
				logger.debug(CmdIntent.Rename, appState.currentNode.fields.title);
				patchState({mode: Mode.COMMAND_LINE});
				setCmdInput(
					() =>
						`${CmdIntent.Rename} ${
							appState.currentNode.children[appState.selectedIndex]?.fields
								.title
						}`,
				);
			}
		},
	},
];
