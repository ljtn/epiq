import {materializeAndPersist} from '../../../event/event-materialize-and-persist.js';
import {
	failed,
	isFail,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../../command-line/command-types.js';
import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getState} from '../../state/state.js';
import {getOrderedChildren} from '../../../repository/rank.js';

const getSelectedChild = ():
	| ReturnSuccess<NavNode<AnyContext>>
	| ReturnFail => {
	const {currentNode, selectedIndex} = getState();
	const children = getOrderedChildren(currentNode.id);
	const targetNode = children[selectedIndex];

	if (!targetNode) return failed('Target node not found');
	return succeeded('Resolved selected child', targetNode);
};

export function moveNodeToSiblingContainer(direction: -1 | 1) {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {currentNode, nodes} = getState();
	if (!currentNode.parentNodeId) return failed('Missing parent node id');

	const parentNode = nodes[currentNode.parentNodeId];
	if (!parentNode) return failed('Missing parent node');

	const siblings = getOrderedChildren(parentNode.id);
	const currentIndex = siblings.findIndex(({id}) => id === currentNode.id);
	if (currentIndex < 0) return failed('Current node not found among siblings');

	const siblingNode = siblings[currentIndex + direction];
	if (!siblingNode) return failed('Missing sibling node');

	return materializeAndPersist({
		action: 'move.node',
		payload: {
			id: selectedChildResult.data.id,
			parentId: siblingNode.id,
			position: {type: 'end'},
		},
	});
}

export function moveChildWithinParent(direction: -1 | 1) {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {currentNode, selectedIndex} = getState();
	const siblings = getOrderedChildren(currentNode.id);

	const referenceNode = siblings[selectedIndex + direction];
	if (!referenceNode) return failed('Missing sibling node');

	return materializeAndPersist({
		action: 'move.node',
		payload: {
			id: selectedChildResult.data.id,
			parentId: currentNode.id,
			position: {
				type: direction === 1 ? 'after' : 'before',
				siblingId: referenceNode.id,
			},
		},
	});
}
