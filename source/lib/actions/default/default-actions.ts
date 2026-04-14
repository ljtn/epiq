import {openEditorOnText} from '../../../editor/editor.js';
import {materializeAndPersist} from '../../../event/event-materialize-and-persist.js';
import {
	CmdKeywords,
	failed,
	isFail,
	succeeded,
} from '../../command-line/command-types.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {findInBreadCrumb} from '../../model/app-state.model.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {getRenderedChildren, getState, patchState} from '../../state/state.js';
import {Intent} from '../../utils/key-intent.js';
import {navigationUtils} from './navigation-action-utils.js';

export const DefaultActions: ActionEntry[] = [
	// Revisit. Perhaps implement an operator input state for this in vim style. For now restrict delete to command line
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
			const issueResult = findInBreadCrumb(getState().breadCrumb, 'TICKET');
			if (isFail(issueResult)) return failed('No issue node');
			const issueNode = issueResult.data;

			const descriptionField = getRenderedChildren(issueNode.id).find(
				x => x?.title === 'Description',
			);

			if (!descriptionField) {
				return failed('Description field not found');
			}

			const currentValue = descriptionField.props.value;

			if (typeof currentValue !== 'string') {
				return failed('Description field is not a text field');
			}

			const editResult = openEditorOnText(currentValue);
			if (isFail(editResult)) return failed('Failed to edit description');

			const updatedMarkdown = editResult.data;

			if (updatedMarkdown === currentValue) {
				return succeeded('No changes made', undefined);
			}

			// Here we need to trigger a reload of the description component, so row indexes are restored

			return materializeAndPersist({
				action: 'edit.description',
				payload: {
					target: descriptionField.id,
					md: updatedMarkdown,
				},
			});
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
];
