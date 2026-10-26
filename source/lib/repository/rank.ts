import {createRebalanceChildrenEvent} from '../board/create-rebalance-children-event.js';
import {materializeAndPersistAll} from '../board/board-log.js';
import {EventActor, MovePosition} from '../board/board-events.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getState, isDeferringDerive} from '../state/state.js';
import {orderChildrenOf} from './children.js';
import {rankBetween} from '../utils/rank.js';

export type ResolveRankResult = {
	rank: string;
	needsRebalance: boolean;
};

export const resolveCreateRank = (
	parentId: string,
): Result<ResolveRankResult> =>
	resolveMoveRank(getOrderedChildren(parentId), {at: 'end'});

export const resolveMoveRank = (
	siblings: NavNode<AnyContext>[],
	position: MovePosition = {at: 'end'},
): Result<ResolveRankResult> => {
	const finish = (rankResult: Result<string>) => {
		if (isFail(rankResult)) {
			return succeeded('Rank space exhausted', {
				rank: '',
				needsRebalance: true,
			});
		}

		return succeeded('Resolved rank', {
			rank: rankResult.value,
			needsRebalance: false,
		});
	};

	if (siblings.length === 0) {
		return finish(rankBetween(undefined, undefined));
	}

	// A sibling missing from a stale view lands the node at the lane's end,
	// rather than dropping the move.
	const appendToLane = () =>
		finish(rankBetween(siblings[siblings.length - 1]?.rank, undefined));

	switch (position.at) {
		case 'start': {
			const first = siblings[0];
			if (!first) return failed('Unable to resolve first sibling');

			return finish(rankBetween(undefined, first.rank));
		}

		case 'end': {
			const last = siblings[siblings.length - 1];
			if (!last) return failed('Unable to resolve last sibling');

			return finish(rankBetween(last.rank, undefined));
		}

		case 'before': {
			const idx = getSiblingIndex(siblings, position.sibling);
			const next = idx < 0 ? undefined : siblings[idx];
			if (!next) return appendToLane();

			const prev = idx > 0 ? siblings[idx - 1] : undefined;

			return finish(rankBetween(prev?.rank, next.rank));
		}

		case 'after': {
			const idx = getSiblingIndex(siblings, position.sibling);
			const prev = idx < 0 ? undefined : siblings[idx];
			if (!prev) return appendToLane();

			const next = idx < siblings.length - 1 ? siblings[idx + 1] : undefined;

			return finish(rankBetween(prev.rank, next?.rank));
		}
	}
};

// A parent's children in rank order: from the derived index when current, else
// by scan (during a replay batch, or with a filter on).
export const getOrderedChildren = (parentId: string) => {
	const state = getState();

	if (!isDeferringDerive() && state.filters.length === 0) {
		const indexed = state.renderedChildrenIndex[parentId];
		if (indexed) return indexed;
	}

	return orderChildrenOf(state.nodes, parentId);
};

export const getSiblingIndex = (
	siblings: NavNode<AnyContext>[],
	sibling: string,
) => siblings.findIndex(node => node.id === sibling);

export const resolveRankForParent = (
	id: string,
	parentId: string,
	position: MovePosition = {at: 'end'},
): Result<ResolveRankResult> =>
	resolveMoveRank(
		getOrderedChildren(parentId).filter(node => node.id !== id),
		position,
	);

export const resolveAndPersistRankForMove = (
	parentId: string,
	nodeId: string,
	position: MovePosition,
	user: EventActor,
	stateBranchRoot: string,
): Result<string> => {
	const first = resolveRankForParent(nodeId, parentId, position);
	if (isFail(first)) return first;

	if (!first.value.needsRebalance) {
		return succeeded('Resolved rank', first.value.rank);
	}

	const rebalanceEvent = createRebalanceChildrenEvent(parentId, user);
	if (isFail(rebalanceEvent)) return rebalanceEvent;

	const rebalanceResult = materializeAndPersistAll(
		[rebalanceEvent.value],
		stateBranchRoot,
	);
	if (isFail(rebalanceResult)) return rebalanceResult;

	const second = resolveRankForParent(nodeId, parentId, position);
	if (isFail(second)) return second;

	if (second.value.needsRebalance) {
		return failed('Rank rebalance failed to create space');
	}

	return succeeded('Resolved rank after rebalance', second.value.rank);
};

export const resolveAndPersistRankForCreate = (
	parentId: string,
	user: EventActor,
	stateBranchRoot: string,
): Result<string> => {
	const first = resolveCreateRank(parentId);
	if (isFail(first)) return first;

	if (!first.value.needsRebalance) {
		return succeeded('Resolved rank', first.value.rank);
	}

	const rebalanceEvent = createRebalanceChildrenEvent(parentId, user);
	if (isFail(rebalanceEvent)) return rebalanceEvent;

	const rebalanceResult = materializeAndPersistAll(
		[rebalanceEvent.value],
		stateBranchRoot,
	);
	if (isFail(rebalanceResult)) return rebalanceResult;

	const second = resolveCreateRank(parentId);
	if (isFail(second)) return second;

	if (second.value.needsRebalance) {
		return failed('Rank rebalance failed to create space');
	}

	return succeeded('Resolved rank after rebalance', second.value.rank);
};
