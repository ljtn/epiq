import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {failed, isFail, succeeded} from '../../lib/model/result-types.js';
import {MAX_COMMENT_LENGTH} from '../../lib/utils/text.limits.js';
import {ToolInput, boot, getActor, getStateResult} from './boot.js';
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
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

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
		...actorOf(actorResult.value),
		action: 'add.issue.comment',
		payload: {
			id: commentId,
			issue: input.issueId,
			md: body,
			author: actorResult.value.userId,
		},
	} satisfies AppEvent<'add.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue comment', {
		id: commentId,
		issueId: input.issueId,
		body,
	});
};

export const deleteIssueComment = async (input: DeleteIssueCommentInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const commentEvent = stateResult.value.eventLog.find(
		(event): event is AppEvent<'add.issue.comment'> =>
			event.action === 'add.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (!commentEvent) {
		return failed('Unable to resolve comment');
	}

	if (commentEvent.payload.author !== actorResult.value.userId) {
		return failed('You can only delete your own comments');
	}

	const issueResult = findWritableIssue(commentEvent.payload.issue);
	if (isFail(issueResult)) return issueResult;

	const alreadyDeleted = stateResult.value.eventLog.some(
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
		...actorOf(actorResult.value),
		action: 'delete.issue.comment',
		payload: {
			id: input.commentId,
			issue: commentEvent.payload.issue,
		},
	} satisfies AppEvent<'delete.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted issue comment', {
		id: input.commentId,
		issueId: commentEvent.payload.issue,
	});
};

export const editIssueComment = async (input: EditIssueCommentInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const commentEvent = stateResult.value.eventLog.find(
		(event): event is AppEvent<'add.issue.comment'> =>
			event.action === 'add.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (!commentEvent) {
		return failed('Unable to resolve comment');
	}

	if (commentEvent.payload.author !== actorResult.value.userId) {
		return failed('You can only edit your own comments');
	}

	const issueResult = findWritableIssue(commentEvent.payload.issue);
	if (isFail(issueResult)) return issueResult;

	const deleted = stateResult.value.eventLog.some(
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
		...actorOf(actorResult.value),
		action: 'edit.issue.comment',
		payload: {
			id: input.commentId,
			issue: commentEvent.payload.issue,
			md: body,
		},
	} satisfies AppEvent<'edit.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Edited issue comment', {
		id: input.commentId,
		issueId: commentEvent.payload.issue,
		body,
	});
};
