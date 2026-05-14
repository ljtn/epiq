import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {succeeded} from '../../model/result-types.js';
import {replaceCmdInput} from '../../state/cmd.state.js';
import {patchState} from '../../state/state.js';
import {getUiState, patchUiState} from '../../state/ux-state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigationUtils} from '../default/navigation-action-utils.js';

const closeHelp = () => {
	replaceCmdInput('');
	const {pendingNavTarget} = getUiState();
	patchState({mode: Mode.DEFAULT});

	if (pendingNavTarget) {
		navigationUtils.navigate(pendingNavTarget);
	}

	patchUiState({pendingNavTarget: undefined});
};

export const HelpActions: ActionEntry[] = [
	{
		intent: Intent.ExitCommandLine,
		mode: Mode.HELP,
		action: () => {
			closeHelp();
			return succeeded('Exiting help', null);
		},
	},
	{
		intent: Intent.Exit,
		mode: Mode.HELP,
		action: () => {
			closeHelp();
			return succeeded('Closed help', null);
		},
	},
	{
		intent: Intent.NavPreviousItem,
		mode: Mode.HELP,
		description: '[arrows/hjkl] navigate',
		action: () => {
			navigationUtils.navigateToPreviousItem();
			return succeeded('Navigating to previous help item', null);
		},
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.HELP,
		action: () => {
			navigationUtils.navigateToNextItem();
			return succeeded('Navigating to next help item', null);
		},
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.HELP,
		action: () => {
			navigationUtils.navigateToPreviousContainer();
			return succeeded('Navigating to previous help container', null);
		},
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.HELP,
		action: () => {
			navigationUtils.navigateToNextContainer();
			return succeeded('Navigating to next help container', null);
		},
	},
];
