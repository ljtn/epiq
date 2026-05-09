import {ulid} from 'ulid';
import {openEditorOnText} from '../../editor/editor.js';
import {materializeAndPersist} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {BreadCrumb, findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {FieldNames} from '../../repository/fielNames.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';
import {isTicketNode} from '../../model/context.model.js';

export const editCommand = async () => {
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

	return materializeAndPersist(
		{
			id: ulid(),
			action: 'edit.description',
			payload: {
				id: issueNode.id,
				md: updatedValue,
			},
			...userRes.value,
		},
		persistRoot,
	);
};
