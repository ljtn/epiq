import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {isTextNode} from '../../model/context.model.js';
import {failed, succeeded} from '../../model/result-types.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';
import {getUiState, patchUiState} from '../../state/ux-state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigationUtils} from '../default/navigation-action-utils.js';

const confirmPaletteCommand = (command: string) => {
	patchState({mode: Mode.COMMAND_LINE});

	const {pendingNavTarget} = getUiState();
	if (pendingNavTarget) {
		navigationUtils.navigate(pendingNavTarget);
	}

	patchUiState({pendingNavTarget: undefined});
	setCmdInput(() => `${command} `);
};

const closePalette = () => {
	setCmdInput(() => '');

	const {pendingNavTarget} = getUiState();
	if (pendingNavTarget) {
		navigationUtils.navigate(pendingNavTarget);
	}

	patchUiState({pendingNavTarget: undefined});
	patchState({mode: Mode.DEFAULT});
};

export const PaletteActions: ActionEntry[] = [
	{
		intent: Intent.InitCommandPalette,
		mode: Mode.DEFAULT,
		description:
			'[?] view command palette (explore descriptions for every command)',
		action: () => {
			setCmdInput(() => '');
			const {contextNode, selectedIndex, selectedNode, breadCrumb} = getState();
			patchUiState({
				pendingNavTarget: {
					contextNode,
					selectedIndex,
					selectedNode,
					breadCrumb,
				},
			});

			patchState({mode: Mode.PALETTE});
			return succeeded('Opening command palette', null);
		},
	},

	{
		intent: Intent.Confirm,
		mode: Mode.PALETTE,
		action: () => {
			const {selectedNode} = getState();

			if (!selectedNode || !isTextNode(selectedNode)) {
				return failed('Command only applicable on text nodes');
			}

			if (selectedNode.props.disabled) {
				return failed('Command is not available in this context');
			}

			const command = selectedNode.title;
			if (!command) return succeeded('No command selected', null);

			confirmPaletteCommand(command);

			return succeeded('Selected command', command);
		},
	},

	{
		intent: Intent.ExitCommandLine,
		mode: Mode.PALETTE,
		action: () => {
			closePalette();
			return succeeded('Exiting palette', null);
		},
	},

	{
		intent: Intent.Exit,
		mode: Mode.PALETTE,
		action: () => {
			closePalette();
			return succeeded('Closed command palette', null);
		},
	},

	{
		intent: Intent.NavPreviousItem,
		mode: Mode.PALETTE,
		description: '[arrows/hjkl] navigate',
		action: () => {
			navigationUtils.navigateToPreviousItem();
			return succeeded('Navigating to previous item', null);
		},
	},
	{
		intent: Intent.NavNextItem,
		mode: Mode.PALETTE,
		action: () => {
			navigationUtils.navigateToNextItem();
			return succeeded('Navigating to next item', null);
		},
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode: Mode.PALETTE,
		action: () => {
			navigationUtils.navigateToPreviousContainer();
			return succeeded('Navigating to previous container', null);
		},
	},
	{
		intent: Intent.NavToNextContainer,
		mode: Mode.PALETTE,
		action: () => {
			navigationUtils.navigateToNextContainer();
			return succeeded('Navigating to next container', null);
		},
	},
];
