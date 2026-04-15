import {monotonicFactory} from 'ulid';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
import {isFail} from '../lib/command-line/command-types.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';
import {materializeAndPersistAll} from './event-materialize-and-persist.js';
import {materializeAll} from './event-materialize.js';
import {AppEvent} from './event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from './static-ids.js';
import chalk from 'chalk';

export function getBootNavigationTarget() {
	const workspace = Object.values(getState().nodes).find(
		node => node.context === 'WORKSPACE',
	);

	if (!workspace) {
		throw new Error('No workspace found in event log');
	}

	const [firstBoard] = getRenderedChildren(workspace.id);
	const [firstSwimlane] = firstBoard ? getRenderedChildren(firstBoard.id) : [];

	return firstSwimlane ?? firstBoard ?? workspace;
}

export function navigateToInitialNode() {
	const navigationTarget = getBootNavigationTarget();
	const children =
		getState().renderedChildrenIndex?.[navigationTarget.id] ?? [];

	navigationUtils.navigate({
		currentNode: navigationTarget,
		selectedIndex: children.length > 0 ? 0 : -1,
	});
}

const nextId = monotonicFactory();

export function createDefaultEvents(): readonly AppEvent[] {
	const workspaceId = nextId();
	const boardId = nextId();
	const swimlaneId1 = nextId();
	const swimlaneId2 = nextId();
	const swimlaneId3 = nextId();

	return [
		{
			action: 'init.workspace',
			payload: {id: workspaceId, name: 'Workspace'},
		},
		{
			action: 'add.board',
			payload: {id: boardId, name: 'Default', parent: workspaceId},
		},
		{
			action: 'add.swimlane',
			payload: {id: swimlaneId1, name: 'Todo', parent: boardId},
		},
		{
			action: 'add.swimlane',
			payload: {id: swimlaneId2, name: 'Review', parent: boardId},
		},
		{
			action: 'add.swimlane',
			payload: {id: swimlaneId3, name: 'Done', parent: boardId},
		},
		{
			action: 'add.board',
			payload: {id: CLOSED_BOARD_ID, name: 'Closed', parent: workspaceId},
		},
		{
			action: 'add.swimlane',
			payload: {
				id: CLOSED_SWIMLANE_ID,
				name: 'Closed',
				parent: CLOSED_BOARD_ID,
			},
		},
		{
			action: 'lock.node',
			payload: {id: CLOSED_BOARD_ID},
		},
		{
			action: 'lock.node',
			payload: {id: CLOSED_SWIMLANE_ID},
		},
	] as const satisfies readonly AppEvent[];
}

export function bootStateFromEventLog(eventLog: AppEvent[]) {
	const results =
		eventLog.length === 0
			? materializeAndPersistAll(createDefaultEvents())
			: materializeAll(eventLog);

	const failures = results.filter(isFail);
	if (failures.length > 0) {
		throw new Error(
			[
				chalk.bold.red('Materializing failed'),
				'',
				...failures.map(
					(x, i) => `${chalk.dim.gray(`${i + 1}.`)} ${chalk.dim(x.message)}`,
				),
				'\n',
			].join('\n'),
		);
	}

	navigateToInitialNode();
}
