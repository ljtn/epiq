import {ApiState} from '../../../mcp/api-state.model.js';
import {isFail, Result, succeeded} from '../../../lib/model/result-types.js';
import {plainExcerpt} from '../../../lib/utils/excerpt.js';

// Drops descriptions and comment bodies, which the board never draws; the open
// ticket fetches them. Read defensively: this is on the broadcast path.
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

const findIssue = (state: ApiState, issueId: string) =>
	(state.boards ?? [])
		.flatMap(board => board.swimlanes ?? [])
		.flatMap(swimlane => swimlane.issues ?? [])
		.find(candidate => candidate.id === issueId);

// What the slimmed state leaves out, for the one ticket whose details are open.
export const issueDetail = (
	state: ApiState,
	issueId: string,
): {
	issueId: string;
	description: string;
	comments: ApiState['commentsByIssueId'][string];
} => {
	const issue = findIssue(state, issueId);

	return {
		issueId,
		description: issue?.description ?? '',
		comments: state.commentsByIssueId?.[issueId] ?? [],
	};
};

// Long enough for the sentence that says what a ticket is, short enough that
// the card stays a hint rather than becoming the ticket.
const EXCERPT_LENGTH = 280;

// The one field a hover preview needs. Not `issue:get`, which would evict the
// open ticket from the client's single detail slot.
export const issuePreview = (
	issueId: string,
	description: string,
): {issueId: string; excerpt: string} => ({
	issueId,
	excerpt: plainExcerpt(description, EXCERPT_LENGTH),
});
