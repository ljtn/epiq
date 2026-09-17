import {
	isBoardNode,
	isFieldNode,
	isSwimlaneNode,
	isTicketNode,
	isWorkspaceNode,
} from '../model/context.model.js';
import {failed, isFail, succeeded} from '../model/result-types.js';
import {FieldNames} from '../repository/fielNames.js';
import {isValidEmail} from '../model/email-link.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {initWorkspaceState} from '../state/state.js';
import {EventHandlers} from '../event/event-catalog.js';
import {
	ConvergenceFail,
	materializeFail,
	materializeSkip,
} from '../event/event-materialize.js';
import {AppEvent, AppEventMap} from './board-events.model.js';
import {CLOSED_SWIMLANE_ID} from './static-ids.js';

// How each board event applies to the board's state. Every precondition is a
// `materializeSkip`, so a replay converges over an event that lost a race.

/**
 * The two ways a creation event can damage state rather than add to it.
 *
 * `createNode` writes into the node map unconditionally — it has to, since the
 * TUI rebuilds ephemeral nodes under fixed ids on every render — so a second
 * `add.*` naming a live id replaces that node's title, rank, parent,
 * description, tags, assignees and readonly flag. And a node that is its own
 * parent turns every ancestor walk into a loop.
 *
 * Neither is reachable from this build's writers; both are reachable from a
 * log, which is why they are convergence skips rather than failures. First
 * writer wins, which is the only choice that converges.
 */
const refuseUncreatableNode = (
	id: string,
	parentId: string | undefined,
	event: AppEvent,
): ConvergenceFail | null => {
	if (nodeRepo.getNode(id)) {
		return materializeSkip(`a node with id ${id} already exists`, event);
	}

	if (parentId === id) {
		return materializeSkip('a node cannot be its own parent', event);
	}

	return null;
};

export const boardHandlers: EventHandlers<AppEventMap> = {
	'init.workspace': event => {
		const {id, name, rank} = event.payload;
		const workspace = nodes.workspace(id, name, rank);

		const initResult = initWorkspaceState(workspace);
		if (isFail(initResult)) {
			return materializeFail(initResult.message, event);
		}

		const result = nodeRepo.createNode(workspace);
		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Failed to initialize workspace',
				event,
			);
		}

		if (!isWorkspaceNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Workspace initialized', {
			action: event.action,
			result: result.value,
		});
	},

	'add.workspace': event => {
		const {id, name, rank} = event.payload;

		const uncreatable = refuseUncreatableNode(id, undefined, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.workspace(id, name, rank));

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Failed to add workspace',
				event,
			);
		}

		if (!isWorkspaceNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added workspace', {
			action: event.action,
			result: result.value,
		});
	},

	'add.board': event => {
		const {id, name, parent: parentId, rank} = event.payload;

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.board(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create board', event);
		}

		if (!isBoardNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added board', {
			action: event.action,
			result: result.value,
		});
	},

	'add.swimlane': event => {
		const {id, name, parent: parentId, rank} = event.payload;

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(
			nodes.swimlane(id, name, parentId, rank),
		);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to create swimlane',
				event,
			);
		}

		if (!isSwimlaneNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added swimlane', {
			action: event.action,
			result: result.value,
		});
	},

	'add.issue': event => {
		const {id, name, parent: parentId, rank} = event.payload;

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(nodes.ticket(id, name, parentId, rank));

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create issue', event);
		}

		if (!isTicketNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added issue', {
			action: event.action,
			result: result.value,
		});
	},

	'add.field': event => {
		const {id, name, parent: parentId, val: value, rank} = event.payload;

		const uncreatable = refuseUncreatableNode(id, parentId, event);
		if (uncreatable) return uncreatable;

		const result = nodeRepo.createNode(
			nodes.field({
				id,
				name,
				parentNodeId: parentId,
				rank,
				props: {value},
				childRenderAxis: name.includes(FieldNames.DESCRIPTION)
					? 'vertical'
					: 'horizontal',
			}),
		);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? `Unable to create field: ${name}`,
				event,
			);
		}

		if (!isFieldNode(result.value)) {
			return failed('Unexpected create node return value');
		}

		return succeeded('Added field', {
			action: event.action,
			result: result.value,
		});
	},

	'edit.title': event => {
		const {id, name} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) {
			return materializeSkip(`Unable to locate node with id ${id}`, event);
		}

		const result = nodeRepo.renameNode(id, name);
		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to edit title', event);
		}

		return succeeded('Edited title', {
			action: event.action,
			result: result.value,
		});
	},

	'delete.node': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneNode(id);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to delete node', event);
		}

		return succeeded('Deleted node', {
			action: event.action,
			result: result.value,
		});
	},

	'create.tag': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createTag({id, name});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to create tag', event);
		}

		return succeeded('Tag added', {
			action: event.action,
			result: result.value,
		});
	},

	'tombstone.tag': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneTag(id);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to delete tag', event);
		}

		return succeeded('Tag tombstoned', {
			action: event.action,
			result: result.value,
		});
	},

	'restore.tag': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.restoreTag(id, name);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to restore tag', event);
		}

		return succeeded('Tag restored', {
			action: event.action,
			result: result.value,
		});
	},

	'create.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.createContributor({id, name});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to create contributor',
				event,
			);
		}

		return succeeded('Contributor created', {
			action: event.action,
			result: result.value,
		});
	},

	'rename.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.renameContributor(id, name);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to rename contributor',
				event,
			);
		}

		return succeeded('Contributor renamed', {
			action: event.action,
			result: result.value,
		});
	},

	'tombstone.contributor': event => {
		const {id} = event.payload;
		const result = nodeRepo.tombstoneContributor(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to remove contributor',
				event,
			);
		}

		return succeeded('Contributor tombstoned', {
			action: event.action,
			result: result.value,
		});
	},

	'restore.contributor': event => {
		const {id, name} = event.payload;
		const result = nodeRepo.restoreContributor(id, name);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to restore contributor',
				event,
			);
		}

		return succeeded('Contributor restored', {
			action: event.action,
			result: result.value,
		});
	},

	'add.issue.tag': event => {
		const {id, tag} = event.payload;
		const result = nodeRepo.tag(id, tag);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to tag issue', event);
		}

		return succeeded('Issue tagged', {
			action: event.action,
			result: {tag},
		});
	},

	'remove.issue.tag': event => {
		const {id, tag} = event.payload;
		const result = nodeRepo.untag(id, tag);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to untag issue', event);
		}

		return succeeded('Issue untagged', {
			action: event.action,
			result: {tag},
		});
	},

	'add.issue.assignee': event => {
		const {id, assignee} = event.payload;
		const result = nodeRepo.assign(id, assignee);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to assign issue', event);
		}

		return succeeded('Assigned successfully', {
			action: event.action,
			result: {assignee},
		});
	},

	'remove.issue.assignee': event => {
		const {id, assignee} = event.payload;
		const result = nodeRepo.unassign(id, assignee);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to unassign issue',
				event,
			);
		}

		return succeeded('Issue unassigned', {
			action: event.action,
			result: {assignee},
		});
	},

	'move.node': event => {
		const {id, parent: parentId, rank} = event.payload;

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Failed to move node', event);
		}

		return succeeded('Moved node', {
			action: event.action,
			result: result.value,
		});
	},

	'edit.description': event => {
		const {id, md} = event.payload;
		const result = nodeRepo.editValue(id, md);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to edit description',
				event,
			);
		}

		return succeeded('Set node value', {
			action: event.action,
			result: result.value,
		});
	},

	'close.issue': event => {
		const {id, parent: parentId, rank} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) return materializeSkip('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeSkip('Can only close issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeSkip('Unable to locate target swimlane', event);
		}

		if (parentId !== closeSwimlane.id) {
			return materializeSkip('Close target must be closed swimlane', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to close issue', event);
		}

		return succeeded('Issue closed', {
			action: event.action,
			result: {id},
		});
	},

	'reopen.issue': event => {
		const {id, parent: parentId, rank} = event.payload;
		const node = nodeRepo.getNode(id);

		if (!node) return materializeSkip('Unable to locate issue', event);
		if (!isTicketNode(node))
			return materializeSkip('Can only reopen issues', event);

		const closeSwimlane = nodeRepo.getNode(CLOSED_SWIMLANE_ID);
		if (!closeSwimlane) {
			return materializeSkip('Unable to locate closed swimlane', event);
		}

		if (parentId === closeSwimlane.id) {
			return materializeSkip('Cannot reopen issue into closed swimlane', event);
		}

		const previousParent = nodeRepo.getNode(parentId);
		if (!previousParent) {
			return materializeSkip('Reopen parent no longer exists', event);
		}

		const result = nodeRepo.moveNodeToRank({
			id,
			parentId,
			rank,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to reopen issue', event);
		}

		return succeeded('Issue reopened', {
			action: event.action,
			result: {id},
		});
	},

	'lock.node': event => {
		const {id} = event.payload;
		const result = nodeRepo.lockNode(id);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to lock node', event);
		}

		return succeeded('Node locked', {
			action: event.action,
			result: result.value,
		});
	},

	'rebalance.children': event => {
		const {parent, ranks} = event.payload;

		for (const [id, rank] of Object.entries(ranks)) {
			const node = nodeRepo.getNode(id);

			if (!node) return materializeSkip(`Unable to locate node ${id}`, event);

			if (node.parentNodeId !== parent) {
				return materializeSkip(`Node ${id} is not child of ${parent}`, event);
			}

			const result = nodeRepo.updateNode({
				...node,
				rank,
			});

			if (isFail(result)) {
				return materializeSkip(
					result.message ?? 'Unable to rebalance child',
					event,
				);
			}
		}

		return succeeded('Rebalanced children', {
			action: event.action,
			result: {parent},
		});
	},

	'add.issue.comment': event => {
		const {id, issue, author, md} = event.payload;

		const result = nodeRepo.createComment({
			id,
			issue,
			authorId: author,
			md,
			deleted: false,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to add comment', event);
		}

		return succeeded('Comment added', {
			action: event.action,
			result: {id, issue, author, md},
		});
	},

	'edit.issue.comment': event => {
		const {id, issue, md} = event.payload;

		const existing = nodeRepo.getComment(id);
		if (!existing) return materializeSkip('Unable to locate comment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Comment does not belong to issue', event);
		}

		const result = nodeRepo.editComment(id, md);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to edit comment', event);
		}

		return succeeded('Comment edited', {
			action: event.action,
			result: {id, issue, md},
		});
	},

	'delete.issue.comment': event => {
		const {id, issue} = event.payload;

		const existing = nodeRepo.getComment(id);
		if (!existing) return materializeSkip('Unable to locate comment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Comment does not belong to issue', event);
		}

		const result = nodeRepo.deleteComment(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to delete comment',
				event,
			);
		}

		return succeeded('Comment deleted', {
			action: event.action,
			result: {id, issue},
		});
	},

	'add.issue.attachment': event => {
		const {id, issue, hash, ext, name, bytes} = event.payload;

		const result = nodeRepo.createAttachment({
			id,
			issue,
			hash,
			ext,
			name,
			bytes,
			deleted: false,
		});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to add attachment',
				event,
			);
		}

		return succeeded('Attachment added', {
			action: event.action,
			result: {id, issue, hash},
		});
	},

	'delete.issue.attachment': event => {
		const {id, issue} = event.payload;

		const existing = nodeRepo.getAttachment(id);
		if (!existing) return materializeSkip('Unable to locate attachment', event);
		if (existing.issue !== issue) {
			return materializeSkip('Attachment does not belong to issue', event);
		}

		const result = nodeRepo.deleteAttachment(id);

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to delete attachment',
				event,
			);
		}

		return succeeded('Attachment deleted', {
			action: event.action,
			result: {id, issue},
		});
	},
	'link.contributor.email': event => {
		const {contributor, email} = event.payload;

		// Checked here rather than in the payload schema: a future epiq may accept
		// an address this build would reject, and a skip leaves that event in the
		// log for a newer reader instead of quarantining the line.
		if (!isValidEmail(email)) {
			return materializeSkip(`not an email address: ${email}`, event);
		}

		const result = nodeRepo.linkContributorEmail({
			email,
			contributor,
			authorId: event.userId,
		});

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to link email', event);
		}

		return succeeded('Email linked to contributor', {
			action: event.action,
			result: result.value,
		});
	},

	'unlink.contributor.email': event => {
		const {contributor, email} = event.payload;

		// The permission check reads the link's own author and target, both of
		// which are in the ordered log. Anything read off a log file name would
		// let two replicas holding different files decide this differently.
		const result = nodeRepo.unlinkContributorEmail(
			email,
			contributor,
			event.userId,
		);

		if (isFail(result)) {
			return materializeSkip(result.message ?? 'Unable to unlink email', event);
		}

		return succeeded('Email unlinked from contributor', {
			action: event.action,
			result: result.value,
		});
	},

	'link.contributor.user': event => {
		const {contributor} = event.payload;

		const result = nodeRepo.linkUserId({
			contributorId: contributor,
			userId: event.userId,
		});

		if (isFail(result)) {
			return materializeSkip(
				result.message ?? 'Unable to link contributor',
				event,
			);
		}

		return succeeded('Contributor linked to user', {
			action: event.action,
			result: {
				contributor,
				userId: event.userId,
			},
		});
	},
};
