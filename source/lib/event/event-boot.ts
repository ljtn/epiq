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
import {nodeRepo} from '../repository/node-repo.js';
import {getLastUnreadableEvents, UnreadableEvent} from './event-load.js';
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
		// `init` persists these directly, bypassing `ensureContributorExists`, so
		// the author registers themselves here or not at all. Second, not first:
		// `init.workspace` is what initializes the state every other
		// materializer reads.
		{
			id: ulid(),
			userId: userId,
			userName: userName,
			action: 'create.contributor',
			payload: {
				id: userId,
				name: userName,
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

// Writing to a node whose history we cannot fully read is a write on a stale
// view. Scoped per node so one unknown event type does not cost the board.
const applyUnreadableLocks = (unreadable: UnreadableEvent[]): void => {
	if (unreadable.length === 0) return;

	// Never skipped: the board-wide fallback below is a fallback, not a
	// replacement.
	const unlocalized = unreadable.filter(event => {
		if (!event.targetNodeId) return true;

		const marked = nodeRepo.markNodeUnreadable(
			event.targetNodeId,
			`Part of this item's history was written by a newer epiq (${event.detail}) and cannot be read. Upgrade to edit it.`,
		);

		// The id named a node this build never materialized — typically because
		// the unreadable event is what *created* it, or because it is a tag or
		// contributor rather than a node. Nothing was locked, so nothing bounds
		// what the event affected either.
		return isFail(marked);
	});

	if (unlocalized.length === 0) return;

	const detail = [...new Set(unlocalized.map(event => event.detail))].join(
		', ',
	);

	patchState({
		readOnly: true,
		readOnlyReason: `This build cannot read ${unlocalized.length} event(s) in the log (${detail}), and cannot tell which items they affect. Upgrade epiq to edit this board.`,
	});
};

// Re-derives the locks from the last full load. Every path back to live —
// `:peek now`, `returnToLive`, the end of a replay — rebuilds the node graph
// without going through `bootStateFromEventLog`, and would otherwise hand back
// a writable board over a log this build cannot fully read.
export const relockUnreadableEvents = (): void =>
	applyUnreadableLocks(getLastUnreadableEvents());

export function bootStateFromEventLog(
	eventLog: AppEvent[],
	unreadable: UnreadableEvent[] = [],
): Result {
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

	// After materializing: the nodes have to exist before they can be locked.
	applyUnreadableLocks(unreadable);

	return succeeded('State booted successfully', null);
}
