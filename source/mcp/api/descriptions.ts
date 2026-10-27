import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {
	Board,
	Swimlane,
	Ticket,
	isBoardNode,
	isSwimlaneNode,
} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {
	descriptionLimitOf,
	normalizeDescription,
	tooLong,
} from '../../lib/utils/text.limits.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {getTimeTravelStatus} from '../epiq-time-travel.js';
import {
	Actor,
	ToolInput,
	bootedWithActorAndState,
	getStateResult,
} from './boot.js';
import {findWritableBoard, findWritableSwimlane} from './node-targets.js';
import {findGoal} from '../../lib/utils/goal.utils.js';

type EditBoardDescriptionInput = ToolInput & {
	boardId: string;
	description: string;
};

type EditSwimlaneDescriptionInput = ToolInput & {
	swimlaneId: string;
	description: string;
};

export type DescriptionEdit = {id: string; ref: string; description: string};

// A board's or lane's description holds the conventions agents follow there.
// Spread into a response, and nothing when the node says nothing.
const nodeDescription = (id: string | null | undefined): string | undefined => {
	if (!id) return undefined;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return undefined;

	const node = stateResult.value.nodes[id];
	if (!node || !(isBoardNode(node) || isSwimlaneNode(node))) return undefined;

	const description = node.props?.description;

	return description?.trim() ? description : undefined;
};

export const laneDescriptionOf = (
	laneId: string | null | undefined,
): {laneDescription?: string} => {
	const laneDescription = nodeDescription(laneId);
	return laneDescription ? {laneDescription} : {};
};

export const boardDescriptionOf = (
	boardId: string | null | undefined,
): {boardDescription?: string} => {
	const boardDescription = nodeDescription(boardId);
	return boardDescription ? {boardDescription} : {};
};

export const descriptionOf = (
	id: string | null | undefined,
): {description?: string} => {
	const description = nodeDescription(id);
	return description ? {description} : {};
};

/**
 * The one write of a description, for tickets, lanes, boards and goals. Holds
 * the cap, the scrub guard and the no-op on unchanged text.
 */
export const writeDescription = ({
	node,
	label,
	max,
	description: given,
	actor,
	stateBranchRoot,
	action = 'edit.description',
}: {
	node: Ticket | Board | Swimlane | {id: string; props: {description?: string}};
	label: string;
	max: number;
	description: string;
	actor: Actor;
	stateBranchRoot: string;
	// A goal's has its own event, as its name does.
	action?: 'edit.description' | 'edit.goal.description';
}): Result<DescriptionEdit> => {
	const description = normalizeDescription(given);
	const overLong = tooLong(label, description, max);
	if (overLong) return failed(overLong);

	// A board is never forced readonly by a scrub, so the guard is here.
	if (getTimeTravelStatus().mode !== 'live') {
		return failed(
			`Cannot edit the ${label.toLowerCase()} while time travelling`,
		);
	}

	const edit = {id: node.id, ref: nodeRef(node.id), description};

	if ((node.props?.description ?? '') === description) {
		return succeeded('No changes made', edit);
	}

	const event = {
		id: ulid(),
		...actorOf(actor),
		action,
		payload: {id: node.id, md: description},
	} satisfies AppEvent<'edit.description' | 'edit.goal.description'>;

	const results = materializeAndPersistAll([event], stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded(`Edited ${label.toLowerCase()}`, edit);
};

export const editBoardDescription = async (
	input: EditBoardDescriptionInput,
): Promise<Result<DescriptionEdit>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const boardResult = findWritableBoard(input.boardId);
	if (isFail(boardResult)) return boardResult;

	return writeDescription({
		node: boardResult.value,
		label: 'Board description',
		max: descriptionLimitOf('board'),
		description: input.description,
		actor: ready.value.actor,
		stateBranchRoot: ready.value.boot.stateBranchRoot,
	});
};

export const editSwimlaneDescription = async (
	input: EditSwimlaneDescriptionInput,
): Promise<Result<DescriptionEdit>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const laneResult = findWritableSwimlane(input.swimlaneId);
	if (isFail(laneResult)) return laneResult;

	return writeDescription({
		node: laneResult.value,
		label: 'Swimlane description',
		max: descriptionLimitOf('swimlane'),
		description: input.description,
		actor: ready.value.actor,
		stateBranchRoot: ready.value.boot.stateBranchRoot,
	});
};

/** A goal's description, by its id or name. */
export const editGoalDescription = async (
	input: ToolInput & {goal: string; description: string},
): Promise<Result<DescriptionEdit>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const goal = findGoal(input.goal);
	if (!goal) return failed(`No goal called or with the id "${input.goal}"`);

	return writeDescription({
		node: {id: goal.id, props: {description: goal.description}},
		label: 'Goal description',
		action: 'edit.goal.description',
		max: descriptionLimitOf('goal'),
		description: input.description,
		actor: ready.value.actor,
		stateBranchRoot: ready.value.boot.stateBranchRoot,
	});
};
