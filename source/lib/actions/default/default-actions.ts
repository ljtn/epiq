import {CmdKeywords, succeeded} from '../../command-line/command-types.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from '../input/on-cmd-input-confirm.js';
import {navigationUtils} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	{
		intent: Intent.AddItem,
		mode: Mode.DEFAULT,
		description: '[n] new...',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${CmdKeywords.NEW} `);
			return succeeded('Adding new item', null);
		},
	},
	{
		intent: Intent.Delete,
		mode: Mode.DEFAULT,
		description: '[d] delete',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${CmdKeywords.DELETE} `);
			return succeeded('Deleting item', null);
		},
	},
	{
		intent: Intent.InitCommandLine,
		mode: Mode.DEFAULT,
		description: '[:] focus command line',
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => ''); // Trigger hints
			return succeeded('Entering command line mode', null);
		},
	},
	{
		intent: Intent.Confirm,
		mode: Mode.DEFAULT,
		description: '[<Enter>] confirm/enter',
		action: () => {
			navigationUtils.enterChildNode();
			return succeeded('Entering context', null);
		},
	},
	{
		intent: Intent.Exit,
		mode: Mode.DEFAULT,
		description: '[q] exit context',
		action: () => {
			navigationUtils.enterParentNode();
			return succeeded('Exiting context', null);
		},
	},
	{
		intent: Intent.NavPreviousItem,
		mode: Mode.DEFAULT,
		description: '[arrows/hjkl] navigate',
		action: () => {
			navigationUtils.navigateToPreviousItem();
			return succeeded('Navigating to previous item', null);
		},
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToNextItem();
			return succeeded('Navigating to next item', null);
		},
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToPreviousContainer();
			return succeeded('Navigating to previous container', null);
		},
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.DEFAULT,
		action: () => {
			navigationUtils.navigateToNextContainer();
			return succeeded('Navigating to next container', null);
		},
	},
	{
		intent: Intent.Edit,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `edit`);
			void onConfirmCommandLineSequenceInput();
			return succeeded('Fired command', true);
		},
	},
	{
		intent: Intent.SetViewDense,
		mode: Mode.DEFAULT,
		description: '[v] view change (wide/dense)',
		action: () => {
			patchState({
				viewMode: 'dense',
			});
			return succeeded('View set', null);
		},
	},
	{
		intent: Intent.SetViewWide,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({
				viewMode: 'wide',
			});
			return succeeded('View set', null);
		},
	},
	// {
	// 	intent: Intent.Sync,
	// 	mode: Mode.DEFAULT,
	// 	description: '[s] sync epiq with remote state branch',
	// 	action: () => {
	// 		patchState({mode: Mode.COMMAND_LINE});
	// 		setCmdInput(() => `sync`);
	// 		void onConfirmCommandLineSequenceInput({isForceExecutedBySystem: true});
	// 		return succeeded('Synced', true);
	// 	},
	// },
];
