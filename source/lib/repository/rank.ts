import {MovePosition} from '../event/event.model.js';
import {
	failed,
	Result,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../model/result-types.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {midRank, rankBetween} from '../utils/rank.js';
import {getState} from '../state/state.js';

export const resolveCreateRank = (parentId: string): Result<string> =>
	resolveMoveRank(getOrderedChildren(parentId), {at: 'end'});

export const resolveMoveRank = (
	siblings: NavNode<AnyContext>[],
	position: MovePosition = {at: 'end'},
): ReturnSuccess<string> | ReturnFail => {
	if (siblings.length === 0) {
		return succeeded('Resolved rank', midRank());
	}

	switch (position.at) {
		case 'start': {
			const first = siblings[0];
			if (!first) return failed('Unable to resolve first sibling');
			return succeeded('Resolved rank', rankBetween(undefined, first.rank));
		}

		case 'end': {
			const last = siblings[siblings.length - 1];
			if (!last) return failed('Unable to resolve last sibling');
			return succeeded('Resolved rank', rankBetween(last.rank, undefined));
		}

		case 'before': {
			const idx = getSiblingIndex(siblings, position.sibling);
			if (idx < 0) return failed('Sibling not found');

			const prev = idx > 0 ? siblings[idx - 1] : undefined;
			const next = siblings[idx];

			if (!next) return failed('Sibling not found');
			return succeeded('Resolved rank', rankBetween(prev?.rank, next.rank));
		}

		case 'after': {
			const idx = getSiblingIndex(siblings, position.sibling);
			if (idx < 0) return failed('Sibling not found');

			const prev = siblings[idx];
			const next = idx < siblings.length - 1 ? siblings[idx + 1] : undefined;

			if (!prev) return failed('Sibling not found');
			return succeeded('Resolved rank', rankBetween(prev.rank, next?.rank));
		}
	}
};
export const getOrderedChildren = (parentId: string) => {
	return Object.values(getState().nodes)
		.filter(
			(node): node is NavNode<AnyContext> =>
				!!node && !node.isDeleted && node.parentNodeId === parentId,
		)
		.sort((a, b) => a.rank.localeCompare(b.rank));
};

export const getSiblingIndex = (
	siblings: NavNode<AnyContext>[],
	sibling: string,
) => siblings.findIndex(node => node.id === sibling);
