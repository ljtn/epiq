import {materialize} from '../../../event/event-materialize.js';
import {AppEvent} from '../../../event/event.model.js';
import {getOrderedChildren} from '../../../repository/rank.js';
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

let pendingMoveState: AppEvent | null = null;
export const getMovePendingState = (): AppEvent | null =>
	structuredClone(pendingMoveState);
export const setMovePendingState = (state: AppEvent | null) =>
	(pendingMoveState = state);

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

	setMovePendingState({
		action: 'move.node',
		payload: {
			id: selectedChildResult.data.id,
			parent: siblingNode.id,
			pos: {at: 'end'},
		},
	});
	if (!pendingMoveState) return failed('Could not materialize move state');
	return materialize(pendingMoveState);
}

export function moveChildWithinParent(direction: -1 | 1) {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {currentNode, selectedIndex} = getState();
	const siblings = getOrderedChildren(currentNode.id);

	const referenceNode = siblings[selectedIndex + direction];
	if (!referenceNode) return failed('Missing sibling node');

	setMovePendingState({
		action: 'move.node',
		payload: {
			id: selectedChildResult.data.id,
			parent: currentNode.id,
			pos: {
				at: direction === 1 ? 'after' : 'before',
				sibling: referenceNode.id,
			},
		},
	});
	if (!pendingMoveState) return failed('Could not materialize move state');
	return materialize(pendingMoveState);
}
