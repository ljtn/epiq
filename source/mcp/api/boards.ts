import {ulid} from 'ulid';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {bootStateFromEventLog} from '../../lib/event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../../lib/event/event-load.js';
import {materializeAndPersistAll} from '../../lib/event/event-materialize-and-persist.js';
import {AppEvent, MovePosition} from '../../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/event/static-ids.js';
import {isBoardNode, isSwimlaneNode} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../../lib/repository/rank.js';
import {MAX_TITLE_LENGTH, tooLong} from '../../lib/utils/text.limits.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {getTimeTravelStatus} from '../epiq-time-travel.js';
import {
	ToolInput,
	resolveRepoRoot,
	boot,
	getActor,
	getStateResult,
} from './boot.js';

type ListSwimlanesInput = ToolInput & {
	boardId?: string;
};

type CreateSwimlaneInput = ToolInput & {
	title: string;
	boardId: string;
};

type EditSwimlaneTitleInput = ToolInput & {
	swimlaneId: string;
	title: string;
};

type MoveSwimlaneInput = ToolInput & {
	swimlaneId: string;
	boardId: string;
	position?: MovePosition;
};

type DeleteSwimlaneInput = ToolInput & {
	swimlaneId: string;
};

export const listBoards = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const boards = Object.values(stateResult.value.nodes)
		.filter(n => n.context === 'BOARD' && !n.isDeleted)
		.map(n => ({
			id: n.id,
			ref: nodeRef(n.id),
			title: n.title,
			parentId: n.parentNodeId,
			readonly: Boolean(n.readonly),
		}));

	return succeeded('Listed boards', boards);
};

export const listSwimlanes = async (input: ListSwimlanesInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const swimlanes = Object.values(stateResult.value.nodes)
		.filter(n => n.context === 'SWIMLANE' && !n.isDeleted)
		.filter(n => !input.boardId || n.parentNodeId === input.boardId)
		.map(n => ({
			id: n.id,
			title: n.title,
			boardId: n.parentNodeId,
			isClosed: n.id === CLOSED_SWIMLANE_ID,
			readonly: Boolean(n.readonly),
		}));

	return succeeded('Listed swimlanes', swimlanes);
};

export const createSwimlane = async (input: CreateSwimlaneInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const board = stateResult.value.nodes[input.boardId];
	if (!board) return failed('Board not found');
	if (!isBoardNode(board)) return failed('Target parent must be a board');
	if (board.readonly)
		return failed('Cannot add a swimlane to a readonly board');

	// Boards carry no forced readonly of their own, so unlike the issue and
	// swimlane mutations this one has to check the scrub itself. Without it a
	// write lands on the state branch while the checkout is in the past.
	if (getTimeTravelStatus().mode !== 'live') {
		return failed('Cannot add a swimlane while time travelling');
	}

	const title = sanitizeInlineText(input.title);
	if (!title.trim()) return failed('Swimlane title cannot be empty');

	const overLongTitle = tooLong('Swimlane title', title, MAX_TITLE_LENGTH);
	if (overLongTitle) return failed(overLongTitle);

	const rankResult = resolveAndPersistRankForCreate(
		input.boardId,
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const swimlaneId = ulid();

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'add.swimlane',
		payload: {
			id: swimlaneId,
			name: title,
			parent: input.boardId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'add.swimlane'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Created swimlane', {
		id: swimlaneId,
		ref: nodeRef(swimlaneId),
		title,
		boardId: input.boardId,
	});
};

export const editSwimlaneTitle = async (input: EditSwimlaneTitleInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const swimlane = stateResult.value.nodes[input.swimlaneId];

	if (!swimlane) return failed('Swimlane not found');
	if (!isSwimlaneNode(swimlane))
		return failed('Edit target must be a swimlane');
	if (swimlane.readonly) return failed('Cannot edit readonly swimlane');

	const title = sanitizeInlineText(input.title);
	if (!title.trim()) return failed('Swimlane title cannot be empty');

	const overLongTitle = tooLong('Swimlane title', title, MAX_TITLE_LENGTH);
	if (overLongTitle) return failed(overLongTitle);

	if (swimlane.title === title) {
		return succeeded('No changes made', {
			id: input.swimlaneId,
			ref: nodeRef(input.swimlaneId),
			title,
		});
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'edit.title',
		payload: {
			id: input.swimlaneId,
			name: title,
		},
	} satisfies AppEvent<'edit.title'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Edited swimlane title', {
		id: input.swimlaneId,
		ref: nodeRef(input.swimlaneId),
		title,
	});
};

export const moveSwimlane = async (
	input: MoveSwimlaneInput,
): Promise<Result<{id: string; boardId: string}>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRootResult)) return stateBranchRootResult;

	const eventsResult = loadMergedEventsWithUnreadable(
		stateBranchRootResult.value,
	);
	if (isFail(eventsResult)) return eventsResult;

	const bootStateResult = bootStateFromEventLog(
		eventsResult.value.events,
		eventsResult.value.unreadable,
	);
	if (isFail(bootStateResult)) return bootStateResult;

	const rankResult = resolveAndPersistRankForMove(
		input.boardId,
		input.swimlaneId,
		input.position ?? {at: 'end'},
		actorResult.value,
		stateBranchRootResult.value,
	);

	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'move.node',
		payload: {
			id: input.swimlaneId,
			parent: input.boardId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll(
		[event],
		stateBranchRootResult.value,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Moved swimlane', {
		id: input.swimlaneId,
		ref: nodeRef(input.swimlaneId),
		boardId: input.boardId,
	});
};

export const deleteSwimlane = async (input: DeleteSwimlaneInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const swimlane = stateResult.value.nodes[input.swimlaneId];

	if (!swimlane) return failed('Swimlane not found');
	if (!isSwimlaneNode(swimlane)) {
		return failed('Delete target must be a swimlane');
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'delete.node',
		payload: {
			id: input.swimlaneId,
		},
	} satisfies AppEvent<'delete.node'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted swimlane', {
		id: input.swimlaneId,
		ref: nodeRef(input.swimlaneId),
	});
};
