import {ApiState} from '../../../mcp/api-state.model.js';
import {isFail, Result, succeeded} from '../../../lib/model/result-types.js';

// The board draws titles, refs, tags, assignees and a comment count. It never
// draws a description or a comment body — yet those are ~70% of the payload,
// and a scrub reships the whole thing on every tick. Measured on a 142-issue
// board: 337KB per broadcast, of which 88KB is descriptions and 148KB comment
// bodies. Both are fetched for the one ticket that is open instead.
//
// Comments keep their id, issue and author, so the card's count and the
// scrubber's author filter still work without the text.
// Every collection is read defensively: this sits on the broadcast path, and a
// state missing a field must not stop the GUI hearing about it at all.
export const slimStateForBoard = (state: ApiState): ApiState => ({
	...state,
	boards: (state.boards ?? []).map(board => ({
		...board,
		swimlanes: (board.swimlanes ?? []).map(swimlane => ({
			...swimlane,
			issues: (swimlane.issues ?? []).map(issue => ({
				...issue,
				description: '',
			})),
		})),
	})),
	// Absent rather than empty: every reader already defaults, and on this board
	// 141 of 142 attachment entries were an empty array.
	commentsByIssueId: Object.fromEntries(
		Object.entries(state.commentsByIssueId ?? {})
			.filter(([, comments]) => comments.length > 0)
			.map(([issueId, comments]) => [
				issueId,
				comments.map(comment => ({...comment, body: ''})),
			]),
	),
	attachmentsByIssueId: Object.fromEntries(
		Object.entries(state.attachmentsByIssueId ?? {}).filter(
			([, attachments]) => attachments.length > 0,
		),
	),
});

export const slimStateResult = (result: Result<ApiState>): Result<ApiState> =>
	isFail(result)
		? result
		: succeeded(result.message, slimStateForBoard(result.value));

// What the slimmed state leaves out, for the one ticket whose details are open.
export const issueDetail = (
	state: ApiState,
	issueId: string,
): {
	issueId: string;
	description: string;
	comments: ApiState['commentsByIssueId'][string];
} => {
	const issue = (state.boards ?? [])
		.flatMap(board => board.swimlanes ?? [])
		.flatMap(swimlane => swimlane.issues ?? [])
		.find(candidate => candidate.id === issueId);

	return {
		issueId,
		description: issue?.description ?? '',
		comments: state.commentsByIssueId?.[issueId] ?? [],
	};
};
