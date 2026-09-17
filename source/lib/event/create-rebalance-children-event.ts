import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getOrderedChildren} from '../repository/rank.js';
import {evenlySpacedRanks} from '../utils/rank.js';
import {actorOf, AppEvent, EventActor} from './event.model.js';

export const createRebalanceChildrenEvent = (
	parentId: string,
	user: EventActor,
): Result<AppEvent<'rebalance.children'>> => {
	const children = getOrderedChildren(parentId);
	const ranksResult = evenlySpacedRanks(children.length);

	if (isFail(ranksResult)) return ranksResult;

	const ranks: Record<string, string> = {};

	for (let index = 0; index < children.length; index++) {
		const child = children[index];
		const rank = ranksResult.value[index];

		if (!child || !rank) {
			return failed('Unable to assign rebalance rank');
		}

		ranks[child.id] = rank;
	}

	return succeeded('Created rebalance event', {
		id: ulid(),
		action: 'rebalance.children',
		payload: {
			parent: parentId,
			ranks,
		},
		...actorOf(user),
	});
};
