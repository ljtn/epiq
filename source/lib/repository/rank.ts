import {createRebalanceChildrenEvent} from '../event/create-rebalance-children-event.js';
import {materializeAndPersistAll} from '../event/event-materialize-and-persist.js';
import {MovePosition} from '../event/event.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getState} from '../state/state.js';
import {rankBetween} from '../utils/rank.js';

export type ResolveRankResult = {
	rank: string;
	needsRebalance: boolean;
};

type Actor = {
	userId: string;
	userName: string;
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
			if (idx < 0) return failed('Sibling not found');

			const prev = idx > 0 ? siblings[idx - 1] : undefined;
			const next = siblings[idx];

			if (!next) return failed('Sibling not found');

			return finish(rankBetween(prev?.rank, next.rank));
		}

		case 'after': {
			const idx = getSiblingIndex(siblings, position.sibling);
			if (idx < 0) return failed('Sibling not found');

			const prev = siblings[idx];
			const next = idx < siblings.length - 1 ? siblings[idx + 1] : undefined;

			if (!prev) return failed('Sibling not found');

			return finish(rankBetween(prev.rank, next?.rank));
		}
	}
};

export const getOrderedChildren = (parentId: string) =>
	Object.values(getState().nodes)
		.filter(
			(node): node is NavNode<AnyContext> =>
				!!node && !node.isDeleted && node.parentNodeId === parentId,
		)
		.sort((a, b) => a.rank.localeCompare(b.rank));

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
	user: Actor,
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
	user: Actor,
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
