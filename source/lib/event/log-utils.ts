import {NavNode} from '../model/navigation-node.model.js';

export const resolveReopenParentFromLog = (
	node: NavNode<'TICKET'>,
): string | null => {
	const log = node.log ?? [];

	for (let i = log.length - 1; i >= 0; i--) {
		const entry = log[i];
		if (!entry) continue;

		if (entry.action === 'close.issue' && entry.payload.id === node.id) {
			return entry.payload.parent;
		}
	}

	return null;
};
