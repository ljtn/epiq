import {AppEvent} from '../board/board-events.model.js';
import {Comment, Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';

// From the comment store, as the GUI and MCP count: an edit after a delete
// brings the comment back.
export const getVisibleCommentCount = (ticket: Ticket) =>
	nodeRepo.getCommentsByIssue(ticket.id).length;

export const createCommentNode = (
	comment: CommentItem,
	index: number,
	parentNodeId: string,
): Comment =>
	nodes.comment({
		id: comment.id,
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		name: comment.id,
		props: {
			value: comment.md,
		},
		readonly: false,
		isVirtual: true,
	});

export const isDeleteCommentEvent = (
	event: AppEvent,
): event is AppEvent<'delete.issue.comment'> =>
	event.action === 'delete.issue.comment';

export const isAddCommentEvent = (
	event: AppEvent,
): event is AppEvent<'add.issue.comment'> =>
	event.action === 'add.issue.comment';

export type CommentItem = {
	id: string;
	issue: string;
	md: string;
	authorId: string;
};
