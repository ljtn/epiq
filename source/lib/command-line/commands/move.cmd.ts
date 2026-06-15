import {ulid} from 'ulid';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {
	getMovePendingState,
	moveChildWithinParent,
	moveNodeToSiblingContainer,
	resolveRankForMove,
	setMovePendingState,
} from '../../actions/move/move-actions-utils.js';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {MovePosition} from '../../event/event.model.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';

const syncNavigationToPendingMove = (): Result<null> => {
	const pendingMoveState = getMovePendingState();
	if (!pendingMoveState) return failed('No pending move state');

	const movedNodeId = pendingMoveState.payload.id;
	const parentId = pendingMoveState.payload.parent;

	const parent = getState().nodes[parentId];
	if (!parent) return failed('Move parent not found');

	const selectedIndex = getOrderedChildren(parentId).findIndex(
		node => node.id === movedNodeId,
	);

	if (selectedIndex === -1) {
		return failed('Moved node not found among rendered children');
	}

	navigationUtils.navigate({contextNode: parent, selectedIndex});
	return succeeded('Synchronized navigation to moved node', null);
};

const applyMovePreview = (
	moveResult: Result<unknown>,
	message = 'Moved preview',
): Result<null> => {
	if (isFail(moveResult)) return moveResult;

	const navResult = syncNavigationToPendingMove();
	if (isFail(navResult)) return navResult;

	patchState({mode: Mode.MOVE});
	return succeeded(message, null);
};

export const moveCommand = async (): Promise<Result> => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {modifier} = getCmdState().commandMeta;

	const {contextNode, selectedIndex} = getState();
	const targetNode = getOrderedChildren(contextNode.id)[selectedIndex];

	if (!targetNode) {
		patchState({mode: Mode.DEFAULT});
		return failed('No move target');
	}

	if (modifier === 'start') {
		if (targetNode.readonly) return failed('Target node is read-only');
		if (selectedIndex === -1) return failed('No item selected');
		if (!targetNode.parentNodeId) return failed('Target has no parent');

		const siblings = getOrderedChildren(targetNode.parentNodeId);
		const currentIndex = siblings.findIndex(({id}) => id === targetNode.id);

		if (currentIndex === -1) {
			return failed('Target not found among siblings');
		}

		const previousSibling = siblings[currentIndex - 1];
		const nextSibling = siblings[currentIndex + 1];

		const position: MovePosition =
			nextSibling != null
				? {at: 'before', sibling: nextSibling.id}
				: previousSibling != null
				? {at: 'after', sibling: previousSibling.id}
				: {at: 'start'};

		const rankResult = resolveRankForMove({
			parentId: targetNode.parentNodeId,
			id: targetNode.id,
			position,
		});

		if (isFail(rankResult)) return rankResult;

		setMovePendingState({
			id: ulid(),
			action: 'move.node',
			payload: {
				id: targetNode.id,
				parent: targetNode.parentNodeId,
				rank: rankResult.value.rank,
			},
			...userRes.value,
		});

		patchState({mode: Mode.MOVE});
		return succeeded('Move initialized', null);
	}

	if (modifier === 'next') {
		return applyMovePreview(moveChildWithinParent(1));
	}

	if (modifier === 'previous') {
		return applyMovePreview(moveChildWithinParent(-1));
	}

	if (modifier === 'to-next') {
		return applyMovePreview(moveNodeToSiblingContainer(1));
	}

	if (modifier === 'to-previous') {
		return applyMovePreview(moveNodeToSiblingContainer(-1));
	}

	if (modifier === 'confirm') {
		const pendingMoveState = getMovePendingState();
		if (!pendingMoveState) return failed('No pending move to confirm');

		const persistRootResult = await getPersistRoot();
		if (isFail(persistRootResult)) return persistRootResult;

		const materializeResult = materializeAndPersistAll(
			[pendingMoveState],
			persistRootResult.value,
		);

		if (isFail(materializeResult)) return materializeResult;

		const navResult = syncNavigationToPendingMove();
		if (isFail(navResult)) return navResult;

		setMovePendingState(null);
		patchState({mode: Mode.DEFAULT});

		return succeeded('Moved item', null);
	}

	if (modifier === 'cancel') {
		setMovePendingState(null);
		patchState({mode: Mode.DEFAULT});
		return succeeded('Cancelling move', null);
	}

	return failed('Invalid move modifier');
};
