import {NavNode} from '../model/navigation-node.model.js';

export const resolveReopenParentFromLog = (
	node: NavNode<'TICKET'>,
): string | null => {
	const log = node.log ?? [];

	for (let i = log.length - 1; i >= 0; i--) {
		const entry = log[i];
		if (!entry) continue;

		if (entry.action !== 'close.issue') continue;
		if (entry.payload.id !== node.id) continue;

		for (let j = i - 1; j >= 0; j--) {
			const previousEntry = log[j];

			if (
				previousEntry &&
				'id' in previousEntry.payload &&
				previousEntry.payload.id === node.id &&
				'parent' in previousEntry.payload &&
				previousEntry.payload.parent
			) {
				return previousEntry.payload.parent;
			}
		}

		return null;
	}

	return null;
};
