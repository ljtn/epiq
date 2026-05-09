import {CmdKeywords} from '../../command-line/cmd-keywords.js';
import {ActionEntry, Mode, ModeUnion} from '../../model/action-map.model.js';
import {isTextNode} from '../../model/context.model.js';
import {failed, succeeded} from '../../model/result-types.js';
import {FieldNames} from '../../repository/fielNames.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {patchSettingsState} from '../../state/settings.state.js';
import {getState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {onConfirmCommandLineSequenceInput} from '../input/on-cmd-input-confirm.js';
import {navigationUtils} from './navigation-action-utils.js';

const createNavigationActions = (mode: ModeUnion): ActionEntry[] => [
	{
		intent: Intent.NavPreviousItem,
		mode,
		description: '[arrows/hjkl] navigate',
		action: () => {
			navigationUtils.navigateToPreviousItem();
			return succeeded('Navigating to previous item', null);
		},
	},
	{
		intent: Intent.NavNextItem,
		mode,
		action: () => {
			navigationUtils.navigateToNextItem();
			return succeeded('Navigating to next item', null);
		},
	},
	{
		intent: Intent.NavToPreviousContainer,
		mode,
		action: () => {
			navigationUtils.navigateToPreviousContainer();
			return succeeded('Navigating to previous container', null);
		},
	},
	{
		intent: Intent.NavToNextContainer,
		mode,
		action: () => {
			navigationUtils.navigateToNextContainer();
			return succeeded('Navigating to next container', null);
		},
	},
];

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
		intent: Intent.InitCommandPalette,
		mode: Mode.DEFAULT,
		description: '[?] command palette',
		action: () => {
			patchState({mode: Mode.PALETTE});
			return succeeded('Opening command palette', null);
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
			const {selectedNode, currentNode} = getState();
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
					currentNode.title === FieldNames.DESCRIPTION &&
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
		intent: Intent.Confirm,
		mode: Mode.PALETTE,
		description: '[<Enter>] select command',
		action: () => {
			const {selectedNode} = getState();

			if (!selectedNode || !isTextNode(selectedNode)) {
				return failed('Command only applicable on text nodes');
			}

			if (selectedNode.props.disabled) {
				return failed('Command is not available in this context');
			}

			const command = selectedNode?.title;

			if (!command) return succeeded('No command selected', null);

			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => `${command} `);

			return succeeded('Selected command', command);
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
		intent: Intent.Exit,
		mode: Mode.PALETTE,
		description: '[q] close palette',
		action: () => {
			patchState({mode: Mode.DEFAULT});
			setCmdInput(() => '');

			return succeeded('Closed command palette', null);
		},
	},
	...createNavigationActions(Mode.DEFAULT),
	...createNavigationActions(Mode.PALETTE),
	{
		intent: Intent.Edit,
		mode: Mode.DEFAULT,
		action: () => {
			patchState({mode: Mode.COMMAND_LINE});
			setCmdInput(() => CmdKeywords.EDIT);
			void onConfirmCommandLineSequenceInput();
			return succeeded('Fired command', true);
		},
	},
	{
		intent: Intent.SetViewDense,
		mode: Mode.DEFAULT,
		description: '[v] view change (wide/dense)',
		action: () => {
			patchSettingsState({
				viewMode: 'dense',
			});
			return succeeded('View set', null);
		},
	},
	{
		intent: Intent.SetViewWide,
		mode: Mode.DEFAULT,
		action: () => {
			patchSettingsState({
				viewMode: 'wide',
			});
			return succeeded('View set', null);
		},
	},
];
