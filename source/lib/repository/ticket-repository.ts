import {editSelectedTicketFieldValue} from '../../editor/editor.js';
import {AnyContext, TicketContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getState} from '../state/state.js';
import {storageManager} from '../storage/storage-manager.js';
import {nodeRepository} from './node-repository.js';

function isTicketNode(
	node: NavNode<AnyContext>,
): node is NavNode<TicketContext> {
	return node.context === 'TICKET';
}

export const ticketRepository = {
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

		try {
			const editResult = editSelectedTicketFieldValue(fieldNode);
			if (editResult?.isUpdated) {
				logger.info(`Updated ${editResult.resourceId}`);
				const value = editResult.value || '';
				storageManager.updateResource(editResult.resourceId, value);
				nodeRepository.updateNode({
					...fieldNode,
					props: {...fieldNode.props, value},
				});
			}

			const updatedField = storageManager.readNode?.(fieldNode.id);
			if (!updatedField) {
				logger.error(
					'editSelectedTicketFieldValue: could not reload updated field from storage',
				);
				return true; // edit happened, but state sync failed
			}

			const workspace = storageManager.loadWorkspace();
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
