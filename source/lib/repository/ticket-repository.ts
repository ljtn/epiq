import {editSelectedTicketFieldValue} from '../../editor/editor.js';
import {CmdIntent} from '../command-line/cmd-utils.js';
import {Mode} from '../model/action-map.model.js';
import {
	AnyContext,
	TicketContext,
	TicketFieldContext,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {setCmdInput} from '../state/cmd.state.js';
import {getState, patchState} from '../state/state.js';
import {storage} from '../storage/storage.js';
import {nodeRepository} from './node-repository.js';
import {navigator} from '../actions/default/navigation-action-utils.js';

function isTicketNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketContext> {
	return node.context === 'TICKET';
}
function isFieldNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketFieldContext> {
	return node.context === 'FIELD';
}

export const ticketRepository = {
	edit() {
		const state = getState();

		// Ticket: use editor + repository sync
		if (state.currentNode.context === 'TICKET') {
			const didEdit = this.editSelectedTicketFieldValueFromState();
			if (didEdit) {
				patchState({mode: Mode.DEFAULT});
				// IMPORTANT: don’t pass stale node objects into navigate
				navigator.navigate({selectedIndex: getState().selectedIndex});
			}
			return;
		}

		// Otherwise: use command line
		patchState({mode: Mode.COMMAND_LINE});
		setCmdInput(() => {
			const s = getState();
			return `${CmdIntent.Rename} ${
				s.currentNode.children[s.selectedIndex]?.name ?? ''
			}`;
		});
	},

	/**
	 * Edits the currently selected ticket field using the external editor,
	 * then syncs in-memory state by reloading the updated field node from storage.
	 *
	 * Returns true if an edit was performed, false if not applicable.
	 */
	editSelectedTicketFieldValueFromState(): boolean {
		const state = getState();

		const ticketNode = state.currentNode;
		if (!isTicketNode(ticketNode)) return false;
		const fieldNode = ticketNode.children[state.selectedIndex];
		if (!fieldNode) return false;
		if (!isFieldNode(fieldNode)) {
			logger.error('Node type not editable');
			return false;
		}

		try {
			const editResult = editSelectedTicketFieldValue(fieldNode);
			if (editResult?.isUpdated) {
				logger.info(`Updated ${editResult.resourceId}`);
				const value = editResult.value || '';
				storage.updateResource(editResult.resourceId, value);
				nodeRepository.updateNode({
					...fieldNode,
					props: {
						...fieldNode.props,
						value: value ? value : fieldNode.props['value'] || '',
					},
				});
			}

			const updatedField = storage.readNode?.(fieldNode.id);
			if (!updatedField) {
				logger.error(
					'editSelectedTicketFieldValue: could not reload updated field from storage',
				);
				return true; // edit happened, but state sync failed
			}

			const workspace = storage.loadWorkspace();
			if (!workspace) {
				logger.error('Failed to load workspace.');
				return false;
			}

			return true;
		} catch (err) {
			logger.error('Unable to edit selected field', err);
			return true;
		}
	},
};
