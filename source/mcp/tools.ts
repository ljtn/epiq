import {ulid} from 'ulid';
import {syncAndReloadState} from '../git/sync-and-reload-state.js';
import {resetHardToRemoteState, syncEpiqWithRemote} from '../git/sync.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {createIssueEvents} from '../lib/event/common-events.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent, MovePosition} from '../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {isTicketNode, Ticket} from '../lib/model/context.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../lib/repository/rank.js';
import {getSafeState} from '../lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';

type ToolInput = {
	repoRoot?: string;
};

type SyncInput = ToolInput;

type MoveIssueInput = ToolInput & {
	issueId: string;
	parentId: string;
	position?: MovePosition;
};

type ListIssuesInput = ToolInput & {
	includeClosed?: boolean;
};

type ListSwimlanesInput = ToolInput & {
	boardId?: string;
};

type CreateIssueInput = ToolInput & {
	title: string;
	parentId: string;
};

type CloseIssueInput = ToolInput & {
	issueId: string;
};

type BootResult = {
	repoRoot: string;
	stateBranchRoot: string;
};

type Actor = {
	userId: string;
	userName: string;
};

type EditIssueDescriptionInput = ToolInput & {
	issueId: string;
	description: string;
};

const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

const boot = async (repoRoot?: string): Promise<Result<BootResult>> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	const syncResult = await resetHardToRemoteState(repoRootResult.value);
	if (isFail(syncResult)) return failed(syncResult.message);

	const {stateBranchRoot} = syncResult.value;

	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const bootResult = bootStateFromEventLog(eventsResult.value);
	if (isFail(bootResult)) return failed(bootResult.message);

	return succeeded('Booted Epiq state', {
		repoRoot: repoRootResult.value,
		stateBranchRoot,
	});
};

const getActor = (): Result<Actor> => {
	const actorResult = loadSettingsFromConfig();
	if (isFail(actorResult)) return failed(actorResult.message);

	if (!actorResult.value.userId) return failed('Unable to retrieve user id');
	if (!actorResult.value.userName) {
		return failed('Unable to retrieve user name');
	}

	return succeeded('Resolved actor', {
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
	});
};

const getStateResult = () => {
	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed(stateResult.message);

	return stateResult;
};

const getIssueTags = (ticket: Ticket) =>
	(ticket.props.tags ?? [])
		.map(tag => nodeRepo.getTag(tag))
		.filter(tag => tag != undefined)
		.map(tag => ({id: tag.id, name: tag.name}));

const getIssueAssignees = (ticket: Ticket) =>
	(ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter(contributor => contributor != undefined)
		.map(contributor => ({id: contributor.id, name: contributor.name}));

export const listBoards = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const boards = Object.values(stateResult.value.nodes)
		.filter(n => n.context === 'BOARD')
		.map(n => ({
			id: n.id,
			title: n.title,
			parentId: n.parentNodeId,
			readonly: Boolean(n.readonly),
		}));

	return succeeded('Listed boards', boards);
};

export const listSwimlanes = async (input: ListSwimlanesInput = {}) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const swimlanes = Object.values(stateResult.value.nodes)
		.filter(n => n.context === 'SWIMLANE')
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

export const listIssues = async (input: ListIssuesInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issues = Object.values(stateResult.value.nodes)
		.filter(isTicketNode)
		.filter(n => input.includeClosed || n.parentNodeId !== CLOSED_SWIMLANE_ID)
		.map(n => ({
			id: n.id,
			title: sanitizeInlineText(n.title),
			description: n.props.description ?? '',
			parentId: n.parentNodeId,
			isClosed: n.parentNodeId === CLOSED_SWIMLANE_ID,
			readonly: Boolean(n.readonly),
			tags: getIssueTags(n),
			assignees: getIssueAssignees(n),
		}));

	return succeeded('Listed issues', issues);
};

export const createIssue = async (input: CreateIssueInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForCreate(
		input.parentId,
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const issueEventsResult = createIssueEvents({
		name: input.title,
		parent: input.parentId,
		user: actorResult.value,
		rank: rankResult.value,
	});
	if (isFail(issueEventsResult)) return issueEventsResult;

	const issueEvents = issueEventsResult.value;
	const results = materializeAndPersistAll(
		issueEvents,
		bootResult.value.stateBranchRoot,
	);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	const issueId = issueEvents.find(e => e.action === 'add.issue')?.payload.id;
	if (!issueId) return failed('Unable to determine created issue id');

	return succeeded('Created issue', {
		id: issueId,
		title: input.title,
		parentId: input.parentId,
	});
};

export const closeIssue = async (input: CloseIssueInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForMove(
		CLOSED_SWIMLANE_ID,
		input.issueId,
		{at: 'end'},
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'close.issue',
		payload: {
			id: input.issueId,
			parent: CLOSED_SWIMLANE_ID,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'close.issue'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Closed issue', {id: input.issueId});
};

export const moveIssue = async (input: MoveIssueInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForMove(
		input.parentId,
		input.issueId,
		input.position ?? {at: 'end'},
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'move.node',
		payload: {
			id: input.issueId,
			parent: input.parentId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Moved issue', {
		id: input.issueId,
		parentId: input.parentId,
	});
};

export const sync = async (input: SyncInput = {}) => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed('Sync failed');

	const actor = getActor();
	if (isFail(actor)) return actor;

	const result = await syncEpiqWithRemote({
		cwd: repoRootResult.value,
		ownEventFileName: getPersistFileName(actor.value),
	});

	if (isFail(result)) return result;

	return succeeded('Synced', result.value);
};

export const getEpiqState = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	return succeeded('Retrieved Epiq state', {
		root: bootResult.value.repoRoot,
		stateBranchRoot: bootResult.value.stateBranchRoot,
		nodes: stateResult.value.nodes,
		rootNodeId: stateResult.value.rootNodeId,
		contextNode: stateResult.value.contextNode,
		selectedIndex: stateResult.value.selectedIndex,
		eventLog: stateResult.value.eventLog,
	});
};

export const editIssueDescription = async (
	input: EditIssueDescriptionInput,
) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Edit target must be an issue');
	if (issue.readonly) return failed('Cannot edit readonly issue');

	const currentDescription = issue.props.description ?? '';

	if (currentDescription === input.description) {
		return succeeded('No changes made', {
			id: input.issueId,
			description: currentDescription,
		});
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'edit.description',
		payload: {
			id: input.issueId,
			md: input.description,
		},
	} satisfies AppEvent<'edit.description'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Edited issue description', {
		id: input.issueId,
		description: input.description,
	});
};
