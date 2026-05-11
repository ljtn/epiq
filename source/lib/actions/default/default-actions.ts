import {CmdKeywords} from '../../command-line/cmd-keywords.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {succeeded} from '../../model/result-types.js';
import {FieldNames} from '../../repository/fielNames.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {PaletteActions} from '../palette/palette-actions.js';
import {navigationUtils} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	...PaletteActions,
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
			setCmdInput(() => '');
			return succeeded('Entering command line mode', null);
		},
	},
	{
		intent: Intent.Confirm,
		mode: Mode.DEFAULT,
		description: '[<Enter>] confirm/enter',
		action: () => {
			const {selectedNode, contextNode} = getState();
			const children = getOrderedChildren(selectedNode?.id ?? '');

			if (!children?.length) {
				if (selectedNode?.title === FieldNames.DESCRIPTION) {
					setCmdInput(() => `${CmdKeywords.EDIT} description `);
					patchState({mode: Mode.COMMAND_LINE});
					return succeeded('Propose command', true);
				}

				if (selectedNode?.title === FieldNames.ASSIGNEES) {
					setCmdInput(() => `${CmdKeywords.ASSIGN} `);
					patchState({mode: Mode.COMMAND_LINE});
					return succeeded('Propose command', true);
				}

				if (selectedNode?.title === FieldNames.TAGS) {
					setCmdInput(() => `${CmdKeywords.TAG} `);
					patchState({mode: Mode.COMMAND_LINE});
					return succeeded('Propose command', true);
				}

				if (
					contextNode.title === FieldNames.DESCRIPTION &&
					selectedNode?.context === 'TEXT'
				) {
					setCmdInput(() => `${CmdKeywords.EDIT} description `);
					patchState({mode: Mode.COMMAND_LINE});
					return succeeded('Propose command', true);
				}
			}

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
];
