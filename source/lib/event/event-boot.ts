import {monotonicFactory, ulid} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {Mode} from '../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {nodes} from '../state/node-builder.js';
import {
	getRenderedChildren,
	getSafeState,
	initWorkspaceState,
	patchState,
} from '../state/state.js';
import {rankBetween} from '../utils/rank.js';
import {materializeAll} from './event-materialize.js';
import {AppEvent} from './event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from './static-ids.js';
import {NavNode} from '../model/navigation-node.model.js';
import {AnyContext} from '../model/context.model.js';

const nextId = monotonicFactory();

export function getBootNavigationTarget(): Result<{
	contextNode: NavNode<AnyContext>;
	selectedIndex: number;
}> {
	const stateResult = getSafeState();
	if (isFail(stateResult))
		return failed('Unable to boot. State not initialized');
	const state = stateResult.value;

	const workspace = Object.values(state.nodes).find(
		node => node.context === 'WORKSPACE',
	);

	if (!workspace) {
		throw new Error('No workspace found in event log');
	}

	const [firstBoard] = getRenderedChildren(workspace.id);
	const [firstSwimlane] = firstBoard ? getRenderedChildren(firstBoard.id) : [];

	if (firstSwimlane) {
		const children = state.renderedChildrenIndex?.[firstSwimlane.id] ?? [];
		return succeeded('Resolved boot nav target', {
			contextNode: firstSwimlane,
			selectedIndex: children.length > 0 ? 0 : -1,
		});
	} else if (firstBoard) {
		return succeeded('Resolved boot nav target', {
			contextNode: firstBoard,
			selectedIndex: 0,
		});
	} else if (workspace) {
		return succeeded('Resolved boot nav target', {
			contextNode: workspace,
			selectedIndex: 0,
		});
	} else {
		return succeeded('Resolved boot nav target', {
			contextNode: state.nodes[state.rootNodeId] as NavNode<AnyContext>,
			selectedIndex: 0,
		});
	}
}

export function navigateToInitialNode() {
	const navigationTarget = getBootNavigationTarget();
	if (isFail(navigationTarget)) return navigationTarget;
	return navigationUtils.navigate(navigationTarget.value);
}

export function createDefaultEvents({
	userId,
	userName,
}: {
	userId: string;
	userName: string;
}): Result<readonly AppEvent[]> {
	const workspaceId = nextId();
	const boardId = nextId();
	const swimlaneId1 = nextId();
	const swimlaneId2 = nextId();
	const swimlaneId3 = nextId();

	const workspaceRank = rankBetween(undefined, undefined);
	if (isFail(workspaceRank)) return workspaceRank;

	const defaultBoardRank = rankBetween(undefined, undefined);
	if (isFail(defaultBoardRank)) return defaultBoardRank;

	const closedBoardRank = rankBetween(defaultBoardRank.value, undefined);
	if (isFail(closedBoardRank)) return closedBoardRank;

	const todoRank = rankBetween(undefined, undefined);
	if (isFail(todoRank)) return todoRank;

	const inProgressRank = rankBetween(todoRank.value, undefined);
	if (isFail(inProgressRank)) return inProgressRank;

	const doneRank = rankBetween(inProgressRank.value, undefined);
	if (isFail(doneRank)) return doneRank;

	const closedSwimlaneRank = rankBetween(undefined, undefined);
	if (isFail(closedSwimlaneRank)) return closedSwimlaneRank;

	return succeeded('Created default events', [
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'init.workspace',
			payload: {
				id: workspaceId,
				name: 'Workspace',
				rank: workspaceRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.board',
			payload: {
				id: boardId,
				name: 'Default',
				parent: workspaceId,
				rank: defaultBoardRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId1,
				name: 'Todo',
				parent: boardId,
				rank: todoRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId2,
				name: 'In progress',
				parent: boardId,
				rank: inProgressRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId3,
				name: 'Done',
				parent: boardId,
				rank: doneRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.board',
			payload: {
				id: CLOSED_BOARD_ID,
				name: 'Closed',
				parent: workspaceId,
				rank: closedBoardRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'add.swimlane',
			payload: {
				id: CLOSED_SWIMLANE_ID,
				name: 'Closed',
				parent: CLOSED_BOARD_ID,
				rank: closedSwimlaneRank.value,
			},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'lock.node',
			payload: {id: CLOSED_BOARD_ID},
		},
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'lock.node',
			payload: {id: CLOSED_SWIMLANE_ID},
		},
	] as const satisfies readonly AppEvent[]);
}

// Booting resets `timeMode` to 'live' and `readOnly` to false, so re-booting
// while checked out in the past would silently discard the checkout and reopen
// the mutation guards. Only an explicit non-live mode skips, so an
// uninitialized state still boots normally.
const isCheckedOutInThePast = (): boolean => {
	const stateResult = getSafeState();
	if (isFail(stateResult)) return false;

	const {timeMode} = stateResult.value;
	return timeMode === 'peek' || timeMode === 'replay';
};

export function bootStateFromEventLog(eventLog: AppEvent[]): Result {
	if (isCheckedOutInThePast()) {
		return succeeded(
			'Skipped boot while checked out at a historical point',
			null,
		);
	}

	if (!eventLog.length) {
		const workspace = nodes.workspace(
			'temporary-uninitialized-workspace',
			'Workspace',
			'a0',
		);

		const initResult = initWorkspaceState(workspace);
		if (isFail(initResult)) return initResult;

		patchState({
			hasProjectDefinition: false,
			mode: Mode.DEFAULT,
		});

		return succeeded('Booted uninitialized workspace placeholder', null);
	}

	if (!eventLog.some(e => e.action === 'init.workspace')) {
		return failed('Initialized Epiq project has no workspace init event');
	}

	const results = materializeAll(eventLog);

	const failures = results.filter(isFail);
	if (failures.length > 0) {
		return failed(
			`Materializing failed:\n${failures.map(x => x.message).join('\n')}`,
		);
	}
	navigateToInitialNode();

	patchState({
		hasProjectDefinition: true,
	});

	return succeeded('State booted successfully', null);
}
