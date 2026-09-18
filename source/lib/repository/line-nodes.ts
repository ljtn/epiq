import {NavNode} from '../model/navigation-node.model.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {nodes} from '../state/node-builder.js';
import {withDeferredDerive} from '../state/state.js';
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
 *
 * Built and torn down in one pass each. Deriving the board per node made
 * opening a thousand-line diff cost the best part of a second, and the cost
 * grew with the square of the lines.
 */
export const attachLineNodes = (
	parentId: string,
	lineCount: number,
	idFor: (index: number) => string,
): NavNode<'TEXT'>[] => {
	const created: NavNode<'TEXT'>[] = [];

	const batched = withDeferredDerive(() => {
		for (let index = 0; index < lineCount; index++) {
			const rankResult = bigIntToHex(BigInt(index + 1));
			if (!isSuccess(rankResult)) continue;

			const result = nodeRepo.createNode(
				nodes.text({
					id: idFor(index),
					name: `Line ${index + 1}`,
					parentNodeId: parentId,
					rank: rankResult.value,
					readonly: true,
					isVirtual: true,
				}),
			);

			if (isSuccess(result)) created.push(result.value as NavNode<'TEXT'>);
		}
	});

	// The nodes are written even where the derivation that follows them fails,
	// so they are still the caller's to take down.
	if (isFail(batched)) logger.error(`Line nodes: ${batched.message}`);

	return created;
};

export const detachLineNodes = (lineNodes: NavNode<'TEXT'>[]): void => {
	nodeRepo.deleteNodes(lineNodes.map(node => node.id));
};
