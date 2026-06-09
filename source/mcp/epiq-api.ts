import {ulid} from 'ulid';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {ensureStateBranchWorktree} from '../git/git.js';
import {syncAndReloadState} from '../git/sync-and-reload-state.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {createIssueEvents} from '../lib/event/common-events.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent, MovePosition} from '../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {
	isBoardNode,
	isSwimlaneNode,
	isTicketNode,
	Swimlane,
	Ticket,
} from '../lib/model/context.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getProjectFileContents} from '../lib/project-setup/project-setup.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../lib/repository/rank.js';
import {getSafeState} from '../lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {logger} from '../logger.js';
import {ApiIssue, ApiState, ApiSwimlane} from './api-state.model.js';
import {resolveReopenParentFromLog} from '../lib/event/log-utils.js';
import {getStringColor} from '../lib/utils/color.js';

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

type EditIssueTitleInput = ToolInput & {
	issueId: string;
	title: string;
};

type AddIssueTagInput = ToolInput & {
	issueId: string;
	tagName: string;
};

type RemoveIssueTagInput = ToolInput & {
	issueId: string;
	tagId: string;
};

type AddIssueAssigneeInput = ToolInput & {
	issueId: string;
	assigneeName: string;
};

type RemoveIssueAssigneeInput = ToolInput & {
	issueId: string;
	assigneeId: string;
};

const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

const boot = async (repoRoot?: string): Promise<Result<BootResult>> => {
	const repoRootResult = resolveRepoRoot(repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	const projectFileContents = getProjectFileContents();

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot: repoRootResult.value,
		stateBranchRoot: stateBranchRootResult.value,
		stateBranchName: projectFileContents.stateBranch,
	});

	if (isFail(ensureWorktreeResult)) {
		return failed(ensureWorktreeResult.message);
	}

	const pullResult = await execGit({
		cwd: stateBranchRootResult.value,
		args: ['pull', '--ff-only'],
	});

	if (isFail(pullResult)) {
		logger.info(3, pullResult.message);
	}

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const bootResult = bootStateFromEventLog(eventsResult.value);
	if (isFail(bootResult)) return failed(bootResult.message);

	return succeeded('Booted Epiq state', {
		repoRoot: repoRootResult.value,
		stateBranchRoot: stateBranchRootResult.value,
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
		.map(tag => ({
			id: tag.id,
			name: tag.name,
			color: getStringColor(tag.name),
		}));

const getIssueAssignees = (ticket: Ticket) =>
	(ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter(contributor => contributor != undefined)
		.map(
			contributor =>
				({
					id: contributor.id,
					name: contributor.name,
					color: getStringColor(contributor.name),
				} satisfies ApiIssue['assignees'][number]),
		);

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

	const issues: ApiIssue[] = Object.values(stateResult.value.nodes)
		.filter(isTicketNode)
		.filter(n => input.includeClosed || n.parentNodeId !== CLOSED_SWIMLANE_ID)
		.map(
			n =>
				({
					id: n.id,
					title: sanitizeInlineText(n.title),
					description: n.props.description ?? '',
					parentNodeId: n.parentNodeId!,
					isClosed: n.parentNodeId === CLOSED_SWIMLANE_ID,
					readonly: Boolean(n.readonly),
					tags: getIssueTags(n),
					assignees: getIssueAssignees(n),
				} satisfies ApiIssue),
		);

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

export const reopenIssue = async (input: CloseIssueInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Target node is not issue');

	if (issue.parentNodeId !== CLOSED_SWIMLANE_ID) {
		return failed('Issue is not closed');
	}

	const previousParentId = resolveReopenParentFromLog(issue);

	if (!previousParentId) {
		return failed('Unable to resolve previous parent from issue history');
	}

	if (previousParentId === CLOSED_SWIMLANE_ID) {
		return failed('Previous parent resolves to closed swimlane');
	}

	const previousParent = stateResult.value.nodes[previousParentId];

	if (!previousParent) {
		return failed('Previous parent no longer exists');
	}

	const rankResult = resolveAndPersistRankForMove(
		previousParent.id,
		issue.id,
		{at: 'end'},
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'reopen.issue',
		payload: {
			id: issue.id,
			parent: previousParent.id,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'reopen.issue'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);

	if (failure) {
		return failed(failure.message);
	}

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Reopened issue', {
		id: issue.id,
		parentId: previousParent.id,
	});
};

export const moveIssue = async (
	input: MoveIssueInput,
): Promise<Result<{id: string; parentId: string}>> => {
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return repoRootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateBranchRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});

	if (isFail(stateBranchRootResult)) return stateBranchRootResult;

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return eventsResult;

	const bootStateResult = bootStateFromEventLog(eventsResult.value);
	if (isFail(bootStateResult)) return bootStateResult;

	const rankResult = resolveAndPersistRankForMove(
		input.parentId,
		input.issueId,
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
			id: input.issueId,
			parent: input.parentId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll(
		[event],
		stateBranchRootResult.value,
	);
	const failure = results.find(isFail);

	if (failure) {
		return failed(failure.message);
	}

	const pushResult = await syncEpiqWithRemote({
		cwd: repoRootResult.value,
		ownEventFileName: getPersistFileName(actorResult.value),
	});

	if (isFail(pushResult)) {
		return failed(
			`Moved issue locally, but sync failed: ${pushResult.message}`,
		);
	}

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

export const getGuiState = async (
	input: ToolInput = {},
): Promise<Result<ApiState>> => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const nodes = Object.values(stateResult.value.nodes);
	const boards = nodes.filter(n => isBoardNode(n) && !n.isDeleted);

	const swimlanesByBoardId = new Map<string, Swimlane[]>();
	const ticketsBySwimlaneId = new Map<string, Ticket[]>();

	for (const node of nodes) {
		if (node.isDeleted) continue;

		if (isSwimlaneNode(node) && node.parentNodeId) {
			const list = swimlanesByBoardId.get(node.parentNodeId) ?? [];
			list.push(node);
			swimlanesByBoardId.set(node.parentNodeId, list);
		}

		if (isTicketNode(node) && node.parentNodeId) {
			const list = ticketsBySwimlaneId.get(node.parentNodeId) ?? [];
			list.push(node);
			ticketsBySwimlaneId.set(node.parentNodeId, list);
		}
	}

	return succeeded('Retrieved Epiq GUI state', {
		boards: boards.map(b => ({
			id: b.id,
			title: b.title,
			swimlanes: (swimlanesByBoardId.get(b.id) ?? []).map(
				swimlane =>
					({
						id: swimlane.id,
						title: swimlane.title,
						readonly: Boolean(swimlane.readonly),
						issues: (ticketsBySwimlaneId.get(swimlane.id) ?? [])
							.sort((a, b) => a.rank.localeCompare(b.rank))
							.map(issue => ({
								id: issue.id,
								title: sanitizeInlineText(issue.title),
								description: issue.props.description ?? '',
								readonly: Boolean(issue.readonly),
								tags: getIssueTags(issue),
								assignees: getIssueAssignees(issue),
								parentNodeId: issue.parentNodeId!,
								isClosed: issue.parentNodeId === CLOSED_SWIMLANE_ID,
							})),
						parentNodeId: swimlane.parentNodeId!,
					} satisfies ApiSwimlane),
			),
		})),
		tags: Object.values(stateResult.value.tags).map(x => ({
			...x,
			color: getStringColor(x.name),
		})),
		contributors: Object.values(stateResult.value.contributors).map(x => ({
			...x,
			color: getStringColor(x.name),
		})),
	} satisfies ApiState);
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

export const editIssueTitle = async (input: EditIssueTitleInput) => {
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

	const title = sanitizeInlineText(input.title);

	if (!title.trim()) {
		return failed('Issue title cannot be empty');
	}

	if (issue.title === title) {
		return succeeded('No changes made', {
			id: input.issueId,
			title,
		});
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'edit.title',
		payload: {
			id: input.issueId,
			name: title,
		},
	} satisfies AppEvent<'edit.title'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Edited issue title', {
		id: input.issueId,
		title,
	});
};

export const addIssueTag = async (input: AddIssueTagInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Tag target must be an issue');
	if (issue.readonly) return failed('Cannot tag readonly issue');

	const tagName = sanitizeInlineText(input.tagName).trim();
	if (!tagName) return failed('Tag name cannot be empty');

	const existingTag = Object.values(stateResult.value.tags).find(
		tag => tag.name === tagName,
	);

	const tagId = existingTag?.id ?? ulid();

	const events = [
		...(existingTag
			? []
			: [
					{
						id: ulid(),
						...actorResult.value,
						action: 'create.tag',
						payload: {
							id: tagId,
							name: tagName,
						},
					} satisfies AppEvent<'create.tag'>,
			  ]),
		{
			id: ulid(),
			...actorResult.value,
			action: 'add.issue.tag',
			payload: {
				id: input.issueId,
				tag: tagId,
			},
		} satisfies AppEvent<'add.issue.tag'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Added issue tag', {
		id: input.issueId,
		tag: {id: tagId, name: tagName},
	});
};

export const removeIssueTag = async (input: RemoveIssueTagInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Untag target must be an issue');
	if (issue.readonly) return failed('Cannot untag readonly issue');

	if (!stateResult.value.tags[input.tagId]) {
		return failed('Tag not found');
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'remove.issue.tag',
		payload: {
			id: input.issueId,
			tag: input.tagId,
		},
	} satisfies AppEvent<'remove.issue.tag'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Removed issue tag', {
		id: input.issueId,
		tagId: input.tagId,
	});
};

export const addIssueAssignee = async (input: AddIssueAssigneeInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Assign target must be an issue');
	if (issue.readonly) return failed('Cannot assign readonly issue');

	const assigneeName = sanitizeInlineText(input.assigneeName).trim();
	if (!assigneeName) return failed('Assignee name cannot be empty');

	const existingAssignee = Object.values(stateResult.value.contributors).find(
		contributor => contributor.name === assigneeName,
	);

	const assigneeId = existingAssignee?.id ?? ulid();

	const events = [
		...(existingAssignee
			? []
			: [
					{
						id: ulid(),
						...actorResult.value,
						action: 'create.contributor',
						payload: {
							id: assigneeId,
							name: assigneeName,
						},
					} satisfies AppEvent<'create.contributor'>,
			  ]),
		{
			id: ulid(),
			...actorResult.value,
			action: 'add.issue.assignee',
			payload: {
				id: input.issueId,
				assignee: assigneeId,
			},
		} satisfies AppEvent<'add.issue.assignee'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Added issue assignee', {
		id: input.issueId,
		assignee: {id: assigneeId, name: assigneeName},
	});
};

export const removeIssueAssignee = async (input: RemoveIssueAssigneeInput) => {
	const bootResult = await boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Unassign target must be an issue');
	if (issue.readonly) return failed('Cannot unassign readonly issue');

	if (!stateResult.value.contributors[input.assigneeId]) {
		return failed('Assignee not found');
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'remove.issue.assignee',
		payload: {
			id: input.issueId,
			assignee: input.assigneeId,
		},
	} satisfies AppEvent<'remove.issue.assignee'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const syncResult = await syncAndReloadState();
	if (isFail(syncResult)) return syncResult;

	return succeeded('Removed issue assignee', {
		id: input.issueId,
		assigneeId: input.assigneeId,
	});
};
