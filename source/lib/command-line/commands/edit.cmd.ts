import {ulid} from 'ulid';
import {openEditorOnText} from '../../editor/editor.js';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {CommandLineInput} from '../../model/action-map.model.js';
import {BreadCrumb, findInBreadCrumb} from '../../model/app-state.model.js';
import {isCommentNode, isTicketNode} from '../../model/context.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {FieldNames} from '../../repository/fielNames.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {EditModifiers} from '../command-modifiers.js';

export const editCommand = async (cmdState: CommandLineInput) => {
	const {contextNode, selectedIndex} = getState();
	const selected = getRenderedChildren(contextNode.id)[selectedIndex];

	if (selected && isCommentNode(selected)) {
		return editSelectedComment(cmdState);
	}

	if (cmdState.modifier === EditModifiers.DESCRIPTION) {
		return editInEditor();
	}

	if (cmdState.modifier === EditModifiers.TITLE) {
		const userRes = resolveActorId();
		if (isFail(userRes)) return failed('Unable to resolve user ID');

		const node = selected;
		if (!node) return failed('Missing node');
		if (node.readonly) return failed('Cannot rename readonly node');

		const newName = cmdState.inputString.trim();
		if (!newName) return failed('Provide a title');

		const persistRootResult = await getPersistRoot();
		if (isFail(persistRootResult)) return persistRootResult;

		return materializeAndPersistAll(
			[
				{
					id: ulid(),
					action: 'edit.title',
					payload: {id: node.id, name: newName},
					...userRes.value,
				},
			],
			persistRootResult.value,
		);
	}

	return failed('Unknown edit command');
};

const editSelectedComment = async (cmdState: CommandLineInput) => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const selected = getRenderedChildren(contextNode.id)[selectedIndex];

	if (!selected || !isCommentNode(selected)) {
		return failed('Select a comment first');
	}

	if (selected.readonly) return failed('Cannot edit readonly comment');

	const issueId = contextNode.parentNodeId;
	if (!issueId) return failed('Unable to resolve comment issue');

	const issueNode = getState().nodes[issueId];

	if (!issueNode || !isTicketNode(issueNode)) {
		return failed('Unable to resolve comment issue');
	}

	if (issueNode.readonly) return failed('Cannot edit readonly issue');

	const commentId = selected.id.split(':').at(0) ?? '';
	const comment = nodeRepo.getComment(commentId);

	if (!comment || comment.deleted) {
		return failed('Unable to resolve comment');
	}

	if (comment.issue !== issueNode.id) {
		return failed('Comment does not belong to selected issue');
	}

	if (comment.authorId !== userRes.value.userId) {
		return failed(
			'You can only edit your own comments' +
				comment.authorId +
				'<->' +
				userRes.value.userId,
		);
	}

	const md = cmdState.inputString.trim();
	if (!md) return failed('Provide a comment');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const persistRoot = persistRootResult.value;

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'edit.issue.comment',
				payload: {
					id: comment.id,
					issue: issueNode.id,
					md,
				},
				...userRes.value,
			},
		],
		persistRoot,
	);
};

export const editInEditor = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;
	const persistRoot = persistRootResult.value;

	const {breadCrumb, selectedNode} = getState();
	const issueResult = findInBreadCrumb(
		[...breadCrumb, selectedNode] as BreadCrumb,
		'TICKET',
	);
	if (isFail(issueResult)) return failed('Edit target must be an issue');

	const issueNode = issueResult.value;
	if (!isTicketNode(issueNode)) return failed('Edit target must be an issue');
	if (issueNode.readonly) return failed('Cannot edit readonly issue');

	const target = getRenderedChildren(issueNode.id).find(
		x => x.title === FieldNames.DESCRIPTION,
	);
	if (!target) return failed('No target found');
	if (target.readonly) return failed('Cannot edit readonly field');

	const currentValue = issueNode.props.description ?? '';

	if (typeof currentValue !== 'string') {
		return failed('Selected field is not editable text');
	}

	const editResult = openEditorOnText(currentValue);
	if (isFail(editResult)) return failed('Failed to edit field');

	const updatedValue = editResult.value;

	if (updatedValue === currentValue) {
		return succeeded('No changes made', null);
	}

	return materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'edit.description',
				payload: {
					id: issueNode.id,
					md: updatedValue,
				},
				...userRes.value,
			},
		],
		persistRoot,
	);
};
