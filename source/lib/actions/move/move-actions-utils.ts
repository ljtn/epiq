import {ulid} from 'ulid';
import {materialize} from '../../event/event-materialize.js';
import {resolveActorId} from '../../event/event-persist.js';
import {resolveMoveRank} from '../../repository/rank.js';
import {getOrderedChildren} from '../../repository/node-repo.js';
import {
	failed,
	isFail,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../../model/result-types.js';
import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {AppEvent, MovePosition} from '../../event/event.model.js';

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

export const resolveRankForMove = ({
	id,
	parentId,
	position = {at: 'end'},
}: {
	id: string;
	parentId: string;
	position?: MovePosition;
}) => {
	const siblings = getOrderedChildren(parentId).filter(node => node.id !== id);
	return resolveMoveRank(siblings, position);
};

const createPendingMoveState = ({
	id,
	parentId,
	position,
}: {
	id: string;
	parentId: string;
	position?: MovePosition;
}): ReturnSuccess<AppEvent<'move.node'>> | ReturnFail => {
	const userIdRes = resolveActorId();
	if (isFail(userIdRes)) return failed('Unable to resolve user ID');

	const rankResult = resolveRankForMove({id, parentId, position});
	if (isFail(rankResult)) return rankResult;

	return succeeded('Created pending move state', {
		id: ulid(),
		...userIdRes.value,
		action: 'move.node',
		payload: {
			id,
			parent: parentId,
			rank: rankResult.value,
		},
	});
};

const previewPendingMove = (
	event: AppEvent<'move.node'>,
): ReturnSuccess<unknown> | ReturnFail => {
	setMovePendingState(event);

	const materializedResult = materialize(event, true);
	if (isFail(materializedResult)) return materializedResult;

	return succeeded('Node moved successfully', materializedResult.value);
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

	const pendingResult = createPendingMoveState({
		id: selectedChildResult.value.id,
		parentId: siblingNode.id,
		position: {at: 'end'},
	});

	if (isFail(pendingResult)) return pendingResult;

	return previewPendingMove(pendingResult.value);
}

export function moveChildWithinParent(direction: -1 | 1) {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {currentNode, selectedIndex} = getState();
	const siblings = getOrderedChildren(currentNode.id);

	const referenceNode = siblings[selectedIndex + direction];
	if (!referenceNode) return failed('Missing sibling node');

	const pendingResult = createPendingMoveState({
		id: selectedChildResult.value.id,
		parentId: currentNode.id,
		position: {
			at: direction === 1 ? 'after' : 'before',
			sibling: referenceNode.id,
		},
	});

	if (isFail(pendingResult)) return pendingResult;

	return previewPendingMove(pendingResult.value);
}
