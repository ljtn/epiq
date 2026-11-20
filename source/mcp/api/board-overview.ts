// A board's own numbers, for its panel. Reads the materialized state, like
// lane stats do, so it costs no git; fetched on opening the panel rather than
// ridden along on the board broadcast.

import {nodesOf} from '../../lib/state/state.js';
import {byRank} from '../../lib/repository/children.js';
import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {
	isBoardNode,
	isSwimlaneNode,
	isTicketNode,
} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {deriveBoardOverview} from '../../lib/stats/board-overview.js';
import {BoardOverview} from '../../lib/stats/board-overview.model.js';
import {getStateResult} from './boot.js';

export const getBoardOverview = (input: {
	boardId: string;
}): Result<BoardOverview> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const board = stateResult.value.nodes[input.boardId];
	if (!board || board.isDeleted || !isBoardNode(board)) {
		return failed('Board not found');
	}

	const boardLanes = nodesOf('SWIMLANE').filter(
		node => isSwimlaneNode(node) && node.parentNodeId === board.id,
	);
	const lanes = boardLanes.filter(lane => !lane.isDeleted).sort(byRank);

	return succeeded(
		'Derived board overview',
		deriveBoardOverview({
			boardId: board.id,
			lanes,
			formerLaneIds: boardLanes
				.filter(lane => lane.isDeleted)
				.map(lane => lane.id),
			tickets: nodesOf('TICKET')
				.filter(node => !node.isDeleted)
				.filter(isTicketNode)
				.map(ticket => ({
					id: ticket.id,
					parentNodeId: ticket.parentNodeId,
					history: ticket.history,
					createdAt: ulidTimeMs(ticket.id),
				})),
			now: Date.now(),
		}),
	);
};
