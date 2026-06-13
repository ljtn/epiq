import {AppEvent} from '../event/event.model.js';
import {Comment, Ticket} from '../model/context.model.js';
import {nodes} from '../state/node-builder.js';

export const getVisibleCommentCount = (ticket: Ticket) => {
	const deleted = new Set(
		(ticket.log ?? [])
			.filter(event => event.action === 'delete.issue.comment')
			.map(event => event.payload.id),
	);

	return (ticket.log ?? []).filter(
		event =>
			event.action === 'add.issue.comment' &&
			event.payload.issue === ticket.id &&
			!deleted.has(event.payload.id),
	).length;
};

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
	authorName: string;
};
