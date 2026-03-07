import {CmdKeywords} from '../../command-line/cmd-utils.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {ticketRepository} from '../../repository/ticket-repository.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigator} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	// Revisit. Perhaps implement an operator input state for this in vim style. For now restrict delete to command line
	{
		intent: Intent.AddItem,
		mode: Mode.DEFAULT,
		description: '[a] Add item',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${CmdKeywords.ADD} `);
		},
	},
	{
		intent: Intent.Delete,
		mode: Mode.DEFAULT,
		description: '[d] delete',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${CmdKeywords.DELETE} `);
		},
	},
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
		description: '[ESC/Q] Exit context',
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
		action: () => ticketRepository.edit(),
	},
	{
		intent: Intent.CmdSetViewDense,
		mode: Mode.DEFAULT,
		action: () => {
			logger.info('aha');
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => 'view dense');
		},
	},
	{
		intent: Intent.CmdSetViewWide,
		mode: Mode.DEFAULT,
		action: () => {
			logger.info('iii');
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => 'view wide');
		},
	},
];
