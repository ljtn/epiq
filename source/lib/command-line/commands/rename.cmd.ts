import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {failed, isFail} from '../../model/result-types.js';
import {getCmdArg} from '../../state/cmd.state.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getPersistRootValue} from './command-utils.js';

export const renameCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {contextNode, selectedIndex} = getState();
	const node = getRenderedChildren(contextNode.id)[selectedIndex];
	if (!node) return failed('Missing node');
	if (node.readonly) return failed('Cannot rename readonly node');

	const newName = getCmdArg();
	if (!newName) return failed('Provide a title');

	const persistRootResult = await getPersistRootValue();
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
};
