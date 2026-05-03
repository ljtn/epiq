import chalk from 'chalk';
import {monotonicFactory, ulid} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getRenderedChildren, getState} from '../state/state.js';
import {materializeAll} from './event-materialize.js';
import {persist} from './event-persist.js';
import {AppEvent} from './event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from './static-ids.js';
import {rankBetween} from '../utils/rank.js';

const SYSTEM_ACTOR_ID = `system` as const;
const SYSTEM_ACTOR_NAME = `ACTOR` as const;

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

	logger.debug('Boot navigation target:', {
		workspace: workspace?.id,
		firstBoard: firstBoard?.id,
		firstSwimlane: firstSwimlane?.id,
	});
	if (firstSwimlane) {
		const children = getState().renderedChildrenIndex?.[firstSwimlane.id] ?? [];
		return {
			currentNode: firstSwimlane,
			selectedIndex: children.length > 0 ? 0 : -1,
		};
	} else if (firstBoard) {
		return {
			currentNode: firstBoard,
			selectedIndex: 0,
		};
	} else if (workspace) {
		return {
			currentNode: workspace,
			selectedIndex: 0,
		};
	} else {
		return {
			currentNode: getState().nodes[getState().rootNodeId],
			selectedIndex: 0,
		};
	}
}

export function navigateToInitialNode() {
	const navigationTarget = getBootNavigationTarget();
	navigationUtils.navigate(navigationTarget);
}

export function createDefaultEvents(): readonly AppEvent[] {
	const workspaceId = nextId();
	const boardId = nextId();
	const swimlaneId1 = nextId();
	const swimlaneId2 = nextId();
	const swimlaneId3 = nextId();

	const workspaceRank = rankBetween(undefined, undefined);

	const defaultBoardRank = rankBetween(undefined, undefined);
	const closedBoardRank = rankBetween(defaultBoardRank, undefined);

	const todoRank = rankBetween(undefined, undefined);
	const inProgressRank = rankBetween(todoRank, undefined);
	const doneRank = rankBetween(inProgressRank, undefined);

	const closedSwimlaneRank = rankBetween(undefined, undefined);

	return [
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'init.workspace',
			payload: {id: workspaceId, name: 'Workspace', rank: workspaceRank},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.board',
			payload: {
				id: boardId,
				name: 'Default',
				parent: workspaceId,
				rank: defaultBoardRank,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {id: swimlaneId1, name: 'Todo', parent: boardId, rank: todoRank},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId2,
				name: 'In progress',
				parent: boardId,
				rank: inProgressRank,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {id: swimlaneId3, name: 'Done', parent: boardId, rank: doneRank},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.board',
			payload: {
				id: CLOSED_BOARD_ID,
				name: 'Closed',
				parent: workspaceId,
				rank: closedBoardRank,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: CLOSED_SWIMLANE_ID,
				name: 'Closed',
				parent: CLOSED_BOARD_ID,
				rank: closedSwimlaneRank,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'lock.node',
			payload: {id: CLOSED_BOARD_ID},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
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
		pendingDefaultEvents = null;
		return succeeded('No pending default events to persist', null);
	}

	const failures = pendingDefaultEvents
		.map(event => persist({event}))
		.filter(isFail);

	if (failures.length > 0) {
		return failed(
			[
				chalk.bold.red('Persisting default events failed'),
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

	if (!eventLog.some(e => e.action === 'init.workspace')) {
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
			].join('\n\n See complete log: \n\n') +
				eventLog.map(x => JSON.stringify(x)).join('\n'),
		);
	}

	navigateToInitialNode();
	return succeeded('State booted successfully', null);
}
