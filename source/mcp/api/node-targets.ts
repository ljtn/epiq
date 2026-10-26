import {
	Board,
	Swimlane,
	Ticket,
	isBoardNode,
	isSwimlaneNode,
	isTicketNode,
} from '../../lib/model/context.model.js';
import {
	Result,
	failed,
	isFail,
	succeeded,
} from '../../lib/model/result-types.js';
import {getStateResult} from './boot.js';

// A write's target or parent must be a live, writable node of the expected kind,
// checked here so the event is never written; replay stays tolerant.

export const findWritableIssue = (id: string): Result<Ticket> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[id];
	if (!issue || issue.isDeleted) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Target must be an issue');
	if (issue.readonly) return failed('Issue is readonly');

	return succeeded('Found issue', issue);
};

export const findWritableSwimlane = (id: string): Result<Swimlane> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const lane = stateResult.value.nodes[id];
	if (!lane || lane.isDeleted) return failed('Swimlane not found');
	if (!isSwimlaneNode(lane)) return failed('Target must be a swimlane');
	if (lane.readonly) return failed('Swimlane is readonly');

	return succeeded('Found swimlane', lane);
};

export const findWritableBoard = (id: string): Result<Board> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const board = stateResult.value.nodes[id];
	if (!board || board.isDeleted) return failed('Board not found');
	if (!isBoardNode(board)) return failed('Target must be a board');
	if (board.readonly) return failed('Board is readonly');

	return succeeded('Found board', board);
};
