import chalk from 'chalk';
import {monotonicFactory, ulid} from 'ulid';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';
import {materializeAndPersistAll} from './event-materialize-and-persist.js';
import {materializeAll} from './event-materialize.js';
import {AppEvent} from './event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from './static-ids.js';

const SYSTEM_ACTOR_ID = `system.actor` as const;

const nextId = monotonicFactory();

// Keep the exact events that were used for first materialization,
// so they can be persisted later without regenerating new ids.
let pendingDefaultEvents: readonly AppEvent[] | null = null;

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

export function createDefaultEvents(): readonly AppEvent[] {
	const workspaceId = nextId();
	const boardId = nextId();
	const swimlaneId1 = nextId();
	const swimlaneId2 = nextId();
	const swimlaneId3 = nextId();

	return [
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'init.workspace',
			payload: {id: workspaceId, name: 'Workspace'},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.board',
			payload: {id: boardId, name: 'Default', parent: workspaceId},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.swimlane',
			payload: {id: swimlaneId1, name: 'Todo', parent: boardId},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.swimlane',
			payload: {id: swimlaneId2, name: 'Review', parent: boardId},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.swimlane',
			payload: {id: swimlaneId3, name: 'Done', parent: boardId},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.board',
			payload: {id: CLOSED_BOARD_ID, name: 'Closed', parent: workspaceId},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'add.swimlane',
			payload: {
				id: CLOSED_SWIMLANE_ID,
				name: 'Closed',
				parent: CLOSED_BOARD_ID,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'lock.node',
			payload: {id: CLOSED_BOARD_ID},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			action: 'lock.node',
			payload: {id: CLOSED_SWIMLANE_ID},
		},
	] as const satisfies readonly AppEvent[];
}

export function hasPendingDefaultEvents(): boolean {
	return pendingDefaultEvents !== null;
}

export function persistPendingDefaultEvents(): Result {
	if (!pendingDefaultEvents || pendingDefaultEvents.length === 0) {
		return succeeded('No pending default events to persist', null);
	}

	const result = materializeAndPersistAll(pendingDefaultEvents);

	const failures = result.filter(isFail);
	if (failures.length > 0) {
		return failed(
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

	pendingDefaultEvents = null;
	return succeeded('Persisted pending default events', null);
}

export function bootStateFromEventLog(eventLog: AppEvent[]): Result {
	let results;

	if (eventLog.length === 0) {
		pendingDefaultEvents = createDefaultEvents();
		results = materializeAll([...pendingDefaultEvents]);
	} else {
		pendingDefaultEvents = null;
		results = materializeAll(eventLog);
	}

	const failures = results.filter(isFail);
	if (failures.length > 0) {
		return failed(
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
	return succeeded('State booted successfully', null);
}
