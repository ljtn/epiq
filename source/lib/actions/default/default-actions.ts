import {CmdKeywords} from '../../command-line/command-types.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {ticketRepository} from '../../repository/ticket-repository.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigationUtils} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	// Revisit. Perhaps implement an operator input state for this in vim style. For now restrict delete to command line
	{
		intent: Intent.AddItem,
		mode: Mode.DEFAULT,
		description: '[a] Add item',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${CmdKeywords.NEW} `);
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
		action: navigationUtils.enterChildNode,
	},
	{
		intent: Intent.Exit,
		mode: Mode.DEFAULT,
		description: '[ESC/Q] Exit context',
		action: navigationUtils.enterParentNode,
	},
	{
		mode: Mode.DEFAULT,
		description: '[ARROWS/HJKL] Navigate',
	},

	{
		intent: Intent.NavPreviousItem,
		mode: Mode.DEFAULT,
		action: navigationUtils.navigateToPreviousItem,
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.DEFAULT,
		action: navigationUtils.navigateToNextItem,
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: navigationUtils.navigateToPreviousContainer,
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: navigationUtils.navigateToNextContainer,
	},
	{
		intent: Intent.Edit,
		mode: Mode.DEFAULT,
		action: () => ticketRepository.edit(),
	},
	{
		intent: Intent.SetViewDense,
		mode: Mode.DEFAULT,
		action: () => {
			return patchState({
				viewMode: 'dense',
			});
		},
	},
	{
		intent: Intent.SetViewWide,
		mode: Mode.DEFAULT,
		action: () => {
			return patchState({
				viewMode: 'wide',
			});
		},
	},
];
