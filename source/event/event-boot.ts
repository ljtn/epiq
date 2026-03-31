import {monotonicFactory} from 'ulid';
import {getOrderedChildren} from '../lib/actions/add-item/rank.js';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
import {getState} from '../lib/state/state.js';
import {isFail} from '../lib/command-line/command-types.js';
import {loadMergedEvents} from './event-load.js';
import {materializeAndPersistAll} from './event-materialize-and-persist.js';
import {materializeAll} from './event-materialize.js';
import {AppEvent} from './event.model.js';

const nextId = monotonicFactory();

export const bootStateFromEventLog = () => {
	const eventLog = loadMergedEvents();
	let allMaterialized;

	if (!eventLog.length) {
		const workspaceId = nextId();
		const boardId = nextId();
		const swimlaneId1 = nextId();
		const swimlaneId2 = nextId();
		const swimlaneId3 = nextId();

		const events = [
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
				payload: {id: swimlaneId1, name: 'Todo', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: swimlaneId2, name: 'Review', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: swimlaneId3, name: 'Done', parentId: boardId},
			},
		] as const satisfies readonly AppEvent[];

		allMaterialized = materializeAndPersistAll(events);
	} else {
		allMaterialized = materializeAll(eventLog);
	}

	const failedResults = allMaterialized.filter(isFail);
	if (failedResults.length) {
		throw new Error(
			'Failed to materialize events on boot: ' +
				failedResults.map(x => x.message ?? 'Unknown error').join(', '),
		);
	}

	const workspace = Object.values(getState().nodes).find(
		node => node.context === 'WORKSPACE',
	);
	if (!workspace) {
		logger.error('No workspace found in event log');
		throw new Error('No workspace found in event log');
	}

	const [firstBoard] = getOrderedChildren(workspace.id);
	const [firstSwimlane] = firstBoard ? getOrderedChildren(firstBoard.id) : [];

	const navigationTarget = firstSwimlane ?? firstBoard ?? workspace;

	navigationUtils.navigate({
		currentNode: navigationTarget,
		selectedIndex:
			(getState().renderedChildrenIndex?.[navigationTarget.id]?.length || 0) -
			1,
	});
};
