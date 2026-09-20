import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {MAX_COMMENT_LENGTH} from '../../lib/utils/text.limits.js';
import {ToolInput, bootedWithActorAndState} from './boot.js';
import {findWritableIssue} from './node-targets.js';

type AddIssueCommentInput = ToolInput & {
	issueId: string;
	body: string;
};

type DeleteIssueCommentInput = ToolInput & {
	commentId: string;
};

type EditIssueCommentInput = ToolInput & {
	commentId: string;
	body: string;
};

export const addIssueComment = async (input: AddIssueCommentInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;

	const body = input.body.trim();

	if (!body) {
		return failed('Comment cannot be empty');
	}

	// The single gate for MCP and both GUI transports.
	if (body.length > MAX_COMMENT_LENGTH) {
		return failed(
			`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters (got ${body.length})`,
		);
	}

	const commentId = ulid();

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'add.issue.comment',
		payload: {
			id: commentId,
			issue: input.issueId,
			md: body,
			author: ready.value.actor.userId,
		},
	} satisfies AppEvent<'add.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue comment', {
		id: commentId,
		issueId: input.issueId,
		body,
	});
};

export const deleteIssueComment = async (input: DeleteIssueCommentInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const commentEvent = ready.value.state.eventLog.find(
		(event): event is AppEvent<'add.issue.comment'> =>
			event.action === 'add.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (!commentEvent) {
		return failed('Unable to resolve comment');
	}

	if (commentEvent.payload.author !== ready.value.actor.userId) {
		return failed('You can only delete your own comments');
	}

	const issueResult = findWritableIssue(commentEvent.payload.issue);
	if (isFail(issueResult)) return issueResult;

	const alreadyDeleted = ready.value.state.eventLog.some(
		event =>
			event.action === 'delete.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (alreadyDeleted) {
		return succeeded('Comment already deleted', {
			id: input.commentId,
			issueId: commentEvent.payload.issue,
		});
	}

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'delete.issue.comment',
		payload: {
			id: input.commentId,
			issue: commentEvent.payload.issue,
		},
	} satisfies AppEvent<'delete.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted issue comment', {
		id: input.commentId,
		issueId: commentEvent.payload.issue,
	});
};

export const editIssueComment = async (input: EditIssueCommentInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const commentEvent = ready.value.state.eventLog.find(
		(event): event is AppEvent<'add.issue.comment'> =>
			event.action === 'add.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (!commentEvent) {
		return failed('Unable to resolve comment');
	}

	if (commentEvent.payload.author !== ready.value.actor.userId) {
		return failed('You can only edit your own comments');
	}

	const issueResult = findWritableIssue(commentEvent.payload.issue);
	if (isFail(issueResult)) return issueResult;

	const deleted = ready.value.state.eventLog.some(
		event =>
			event.action === 'delete.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (deleted) return failed('Comment was deleted');

	const body = input.body.trim();

	if (!body) {
		return failed('Comment cannot be empty');
	}

	if (body.length > MAX_COMMENT_LENGTH) {
		return failed(
			`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters (got ${body.length})`,
		);
	}

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'edit.issue.comment',
		payload: {
			id: input.commentId,
			issue: commentEvent.payload.issue,
			md: body,
		},
	} satisfies AppEvent<'edit.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Edited issue comment', {
		id: input.commentId,
		issueId: commentEvent.payload.issue,
		body,
	});
};
