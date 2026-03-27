import {ulid} from 'ulid';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
import {loadEventsFromDir} from './event-load.js';
import {materializeAll} from './event-materialize.js';
import {materializeAndPersistAll} from './event-materialize-and-persist.js';

export const bootStateFromEventLog = () => {
	const eventLog = loadEventsFromDir();
	let allMaterialized;

	if (!eventLog.length) {
		const workspaceId = ulid();
		const boardId = ulid();
		allMaterialized = materializeAndPersistAll([
			{
				action: 'init.workspace',
				payload: {id: workspaceId, name: 'Workspace'},
			},
			{
				action: 'add.board',
				payload: {id: boardId, name: 'Default', parentId: workspaceId},
			},
			{
				action: 'add.swimlane',
				payload: {id: ulid(), name: 'Todo', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: ulid(), name: 'Review', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: ulid(), name: 'Done', parentId: boardId},
			},
		]);
	} else {
		allMaterialized = materializeAll(eventLog);
	}

	const firstSwimlane = allMaterialized.at(2)?.data;

	if (!firstSwimlane || typeof firstSwimlane === 'string')
		return logger.error('Unable to resolve navigation target');

	navigationUtils.navigate({
		currentNode: firstSwimlane,
		selectedIndex: -1,
	});
};
