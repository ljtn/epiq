import {NavNode} from '../lib/model/navigation-node.model.js';

export const resolvePreviousParentFromLog = (
	node: NavNode<'TICKET'>,
): string | null => {
	const log = [...(node.log ?? [])];

	let closeIndex = -1;
	for (let i = log.length - 1; i >= 0; i--) {
		if (log[i]?.action === 'close.issue') {
			closeIndex = i;
			break;
		}
	}

	if (closeIndex === -1) return null;

	for (let i = closeIndex - 1; i >= 0; i--) {
		const entry = log[i];
		if (!entry) continue;

		if (entry.action === 'move.node' && entry.payload.id === node.id) {
			return entry.payload.parent;
		}

		if (entry.action === 'add.issue' && entry.payload.id === node.id) {
			return entry.payload.parent;
		}
	}

	return null;
};
