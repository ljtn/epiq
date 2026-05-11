import {ulid} from 'ulid';
import {materialize} from '../../event/event-materialize.js';
import {resolveActorId} from '../../event/event-persist.js';
import {AppEvent, MovePosition} from '../../event/event.model.js';
import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {
	failed,
	isFail,
	Result,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../../model/result-types.js';
import {getOrderedChildren, resolveMoveRank} from '../../repository/rank.js';
import {getState} from '../../state/state.js';

let pendingMoveState: AppEvent<'move.node'> | null = null;

export const getMovePendingState = (): AppEvent<'move.node'> | null =>
	structuredClone(pendingMoveState);

export const setMovePendingState = (state: AppEvent<'move.node'> | null) => {
	pendingMoveState = state;
};

const getSelectedChild = ():
	| ReturnSuccess<NavNode<AnyContext>>
	| ReturnFail => {
	const {contextNode, selectedIndex} = getState();
	const children = getOrderedChildren(contextNode.id);
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
	position = {at: 'end'},
}: {
	id: string;
	parentId: string;
	position?: MovePosition;
}): Result<AppEvent<'move.node'>> => {
	const userIdRes = resolveActorId();
	if (isFail(userIdRes)) return failed('Unable to resolve user ID');

	const rankResult = resolveRankForMove({parentId, id, position});
	if (isFail(rankResult)) return rankResult;

	return succeeded('Created pending move state', {
		id: ulid(),
		...userIdRes.value,
		action: 'move.node',
		payload: {
			id,
			parent: parentId,
			rank: rankResult.value.rank,
		},
	});
};

const applyPendingMove = (
	pendingMove: AppEvent<'move.node'>,
): Result<{
	action: 'move.node';
	result: NavNode<AnyContext>;
}> => {
	setMovePendingState(pendingMove);

	const materializedResult = materialize(pendingMove, true);
	if (isFail(materializedResult)) return materializedResult;

	return succeeded('Node moved successfully', materializedResult.value);
};

export function moveNodeToSiblingContainer(direction: -1 | 1): Result<{
	action: 'move.node';
	result: NavNode<AnyContext>;
}> {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {contextNode, nodes} = getState();
	if (!contextNode.parentNodeId) return failed('Missing parent node id');

	const parentNode = nodes[contextNode.parentNodeId];
	if (!parentNode) return failed('Missing parent node');

	const siblings = getOrderedChildren(parentNode.id);
	const currentIndex = siblings.findIndex(({id}) => id === contextNode.id);
	if (currentIndex < 0) return failed('Current node not found among siblings');

	const siblingNode = siblings[currentIndex + direction];
	if (!siblingNode) return failed('Missing sibling node');

	const pendingResult = createPendingMoveState({
		id: selectedChildResult.value.id,
		parentId: siblingNode.id,
		position: {at: 'end'},
	});

	if (isFail(pendingResult)) return pendingResult;

	return applyPendingMove(pendingResult.value);
}

export function moveChildWithinParent(direction: -1 | 1): Result<{
	action: 'move.node';
	result: NavNode<AnyContext>;
}> {
	const selectedChildResult = getSelectedChild();
	if (isFail(selectedChildResult)) return selectedChildResult;

	const {contextNode, selectedIndex} = getState();
	const siblings = getOrderedChildren(contextNode.id);

	const referenceNode = siblings[selectedIndex + direction];
	if (!referenceNode) return failed('Missing sibling node');

	const pendingResult = createPendingMoveState({
		id: selectedChildResult.value.id,
		parentId: contextNode.id,
		position: {
			at: direction === 1 ? 'after' : 'before',
			sibling: referenceNode.id,
		},
	});

	if (isFail(pendingResult)) return pendingResult;

	return applyPendingMove(pendingResult.value);
}
