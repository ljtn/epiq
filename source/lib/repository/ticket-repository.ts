import {editSelectedTicketFieldValue} from '../../editor/editor.js';
import {getState} from '../state/state.js';
import {storageManager} from '../storage/storage-manager.js';

export const ticketRepository = {
	/**
	 * Edits the currently selected ticket field using the external editor,
	 * then syncs in-memory state by reloading the updated field node from storage.
	 *
	 * Returns true if an edit was performed, false if not applicable.
	 */
	editSelectedTicketFieldValueFromState(): boolean {
		const state = getState();
		if (state.currentNode.context !== 'TICKET') return false;

		const ticketNode = state.currentNode;
		const fieldNode = ticketNode.children[state.selectedIndex];
		if (!fieldNode) return false;

		try {
			editSelectedTicketFieldValue();

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
