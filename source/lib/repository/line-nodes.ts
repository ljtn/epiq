import {NavNode} from '../model/navigation-node.model.js';
import {isSuccess} from '../model/result-types.js';
import {nodes} from '../state/node-builder.js';
import {bigIntToHex} from '../utils/rank.js';
import {nodeRepo} from './node-repo.js';

/**
 * A nav node per line of something being read.
 *
 * Both surfaces that draw a long read-only text — the event log's inline
 * editor and the diff pager — need the same thing: the TUI scrolls by moving
 * its selection, so a line has to be a node for the cursor to sit on. The rank
 * is the line's own position, so the order is the text's order.
 *
 * The ids are the caller's, because they are already out there: changing them
 * would move the cursor's identity for no reason.
 */
export const attachLineNodes = (
	parentId: string,
	texts: string[],
	idFor: (index: number) => string,
): NavNode<'TEXT'>[] => {
	const created: NavNode<'TEXT'>[] = [];

	texts.forEach((text, index) => {
		const rankResult = bigIntToHex(BigInt(index + 1));
		if (!isSuccess(rankResult)) return;

		const result = nodeRepo.createNode(
			nodes.text({
				id: idFor(index),
				name: `Line ${index + 1}`,
				parentNodeId: parentId,
				rank: rankResult.value,
				props: {value: text},
				readonly: true,
				isVirtual: true,
			}),
		);

		if (isSuccess(result)) created.push(result.value as NavNode<'TEXT'>);
	});

	return created;
};

export const detachLineNodes = (lineNodes: NavNode<'TEXT'>[]): void => {
	for (const node of lineNodes) nodeRepo.deleteNode(node.id);
};
