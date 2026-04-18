import {ulid} from 'ulid';
import {materialize} from '../../../event/event-materialize.js';
import {resolveActorId} from '../../../event/event-persist.js';
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
import {getRenderedChildren, getState} from '../../state/state.js';
import {AppEvent} from '../../../event/event.model.js';

let pendingMoveState: AppEvent<'move.node'> | null = null;

export const getMovePendingState = (): AppEvent<'move.node'> | null =>
	structuredClone(pendingMoveState);

export const setMovePendingState = (state: AppEvent<'move.node'> | null) =>
	(pendingMoveState = state);

const getSelectedChild = ():
	| ReturnSuccess<NavNode<AnyContext>>
	| ReturnFail => {
	const {currentNode, selectedIndex} = getState();
	const children = getRenderedChildren(currentNode.id);
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

	const userIdRes = resolveActorId();
	if (isFail(userIdRes)) return failed('Unable to resolve user ID');
	const userId = userIdRes.data;

	setMovePendingState({
		id: ulid(),
		userId: userId,
		action: 'move.node',
		payload: {
			id: selectedChildResult.data.id,
			parent: siblingNode.id,
			pos: {at: 'end'},
		},
	});

	if (!pendingMoveState) return failed('Could not materialize move state');

	const materializedResult = materialize(pendingMoveState, true);
	if (isFail(materializedResult)) return materializedResult;

	return succeeded('Node moved successfully', materializedResult.data);
}

export function moveChildWithinParent(direction: -1 | 1) {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {currentNode, selectedIndex} = getState();
	const siblings = getOrderedChildren(currentNode.id);

	const referenceNode = siblings[selectedIndex + direction];
	if (!referenceNode) return failed('Missing sibling node');

	const userIdRes = resolveActorId();
	if (isFail(userIdRes)) return failed('Unable to resolve user ID');
	const userId = userIdRes.data;

	setMovePendingState({
		id: ulid(),
		userId: userId,
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

	const materializedResult = materialize(pendingMoveState, true);
	if (isFail(materializedResult)) return materializedResult;

	return succeeded('Node moved successfully', materializedResult.data);
}
