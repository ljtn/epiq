import {ulid} from 'ulid';
import {syncEpiqWithRemote} from '../git/sync.js';
import {resolveRankForMove} from '../lib/actions/move/move-actions-utils.js';
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
import {getRenderedChildren, getState} from '../lib/state/state.js';
import {resolveClosestEpiqRoot} from '../lib/storage/paths.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {getFieldValue} from '../lib/utils/ticket.utils.js';

type SyncInput = ToolInput;
type MoveIssueInput = ToolInput & {
	issueId: string;
	parentId: string;
	position?: MovePosition;
};

type ToolInput = {
	repoRoot?: string;
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
	root: string;
};

type Actor = {
	userId: string;
	userName: string;
};

const boot = (repoRoot?: string): Result<BootResult> => {
	const epiqRootResult = resolveClosestEpiqRoot(repoRoot ?? process.cwd());
	if (isFail(epiqRootResult)) return epiqRootResult;

	const eventsResult = loadMergedEvents(epiqRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const bootResult = bootStateFromEventLog(eventsResult.value);
	if (isFail(bootResult)) return failed(bootResult.message);

	return succeeded('Booted Epiq state', {root: epiqRootResult.value});
};

const getActor = (): Result<Actor> => {
	const actorResult = loadSettingsFromConfig();
	if (isFail(actorResult)) return failed(actorResult.message);

	if (!actorResult.value.userId) return failed('Unable to retrieve user id');
	if (!actorResult.value.userName)
		return failed('Unable to retrieve user name');

	return succeeded('Resolved actor', {
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
	});
};

const getReferencedIds = (
	ticket: Ticket,
	fieldTitle: 'Tags' | 'Assignees',
): string[] => {
	const children = getRenderedChildren(ticket.id);
	const fieldNode = children.find(node => node.title === fieldTitle);

	if (!fieldNode) return [];

	return getRenderedChildren(fieldNode.id)
		.map(child =>
			typeof child.props?.value === 'string' ? child.props.value : '',
		)
		.filter((value): value is string => Boolean(value));
};

const getIssueTags = (ticket: Ticket) =>
	getReferencedIds(ticket, 'Tags')
		.map(tagId => nodeRepo.getTag(tagId))
		.filter(tag => tag != undefined)
		.map(tag => ({
			id: tag.id,
			name: tag.name,
		}));

const getIssueAssignees = (ticket: Ticket) =>
	getReferencedIds(ticket, 'Assignees')
		.map(contributorId => nodeRepo.getContributor(contributorId))
		.filter(contributor => contributor != undefined)
		.map(contributor => ({
			id: contributor.id,
			name: contributor.name,
		}));

export const listBoards = (input: ToolInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const boards = Object.values(getState().nodes)
		.filter(node => node.context === 'BOARD')
		.map(node => ({
			id: node.id,
			title: node.title,
			parentId: node.parentNodeId,
			readonly: Boolean(node.readonly),
		}));

	return succeeded('Listed boards', boards);
};

export const listSwimlanes = (input: ListSwimlanesInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const swimlanes = Object.values(getState().nodes)
		.filter(node => node.context === 'SWIMLANE')
		.filter(node => !input.boardId || node.parentNodeId === input.boardId)
		.map(node => ({
			id: node.id,
			title: node.title,
			boardId: node.parentNodeId,
			isClosed: node.id === CLOSED_SWIMLANE_ID,
			readonly: Boolean(node.readonly),
		}));

	return succeeded('Listed swimlanes', swimlanes);
};

export const listIssues = (input: ListIssuesInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const issues = Object.values(getState().nodes)
		.filter(isTicketNode)
		.filter(
			node => input.includeClosed || node.parentNodeId !== CLOSED_SWIMLANE_ID,
		)
		.map(node => ({
			id: node.id,
			title: sanitizeInlineText(node.title),
			description: getFieldValue(node, 'Description'),
			parentId: node.parentNodeId,
			isClosed: node.parentNodeId === CLOSED_SWIMLANE_ID,
			readonly: Boolean(node.readonly),
			tags: getIssueTags(node),
			assignees: getIssueAssignees(node),
		}));

	return succeeded('Listed issues', issues);
};

export const createIssue = (input: CreateIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const parent = nodeRepo.getNode(input.parentId);
	if (!parent) {
		return failed(`Unable to locate parent swimlane: ${input.parentId}`);
	}

	if (parent.context !== 'SWIMLANE') {
		return failed(`Parent must be a swimlane, got: ${parent.context}`);
	}

	const issueEvents = createIssueEvents({
		name: input.title,
		parent: input.parentId,
		user: actorResult.value,
	});

	const results = materializeAndPersistAll(issueEvents);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const issueId = issueEvents.find(event => event.action === 'add.issue')
		?.payload.id;

	if (!issueId) return failed('Unable to determine created issue id');

	return succeeded('Created issue', {
		id: issueId,
		title: input.title,
		parentId: input.parentId,
	});
};

export const closeIssue = (input: CloseIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const issue = nodeRepo.getNode(input.issueId);
	if (!issue) return failed(`Unable to locate issue: ${input.issueId}`);

	if (!issue.parentNodeId) {
		return failed(`Unable to locate issue parent for: ${input.issueId}`);
	}

	if (!isTicketNode(issue)) return failed('Can only close issues');

	if (issue.parentNodeId === CLOSED_SWIMLANE_ID) {
		return failed('Issue is already closed');
	}

	const rankResult = resolveRankForMove({
		id: input.issueId,
		parentId: CLOSED_SWIMLANE_ID,
		position: {at: 'end'},
	});

	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
		action: 'close.issue',
		payload: {
			id: input.issueId,
			parent: CLOSED_SWIMLANE_ID,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'close.issue'>;

	const results = materializeAndPersistAll([event]);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	return succeeded('Closed issue', {
		id: input.issueId,
		closed: true,
	});
};

export const getEpiqState = (input: ToolInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	return succeeded('Retrieved Epiq state', {
		root: bootResult.value.root,
		nodes: getState().nodes,
		rootNodeId: getState().rootNodeId,
		currentNode: getState().currentNode,
		selectedIndex: getState().selectedIndex,
		eventLog: getState().eventLog,
	});
};

export const moveIssue = (input: MoveIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const issue = nodeRepo.getNode(input.issueId);
	if (!issue) return failed(`Unable to locate issue: ${input.issueId}`);
	if (!isTicketNode(issue)) return failed('Can only move issues');

	const parent = nodeRepo.getNode(input.parentId);
	if (!parent) {
		return failed(`Unable to locate target swimlane: ${input.parentId}`);
	}

	if (parent.context !== 'SWIMLANE') {
		return failed(`Target parent must be a swimlane, got: ${parent.context}`);
	}

	if (parent.readonly) {
		return failed('Cannot move issue to readonly swimlane');
	}

	const position = input.position ?? {at: 'end'};

	const rankResult = resolveRankForMove({
		id: input.issueId,
		parentId: input.parentId,
		position,
	});

	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
		action: 'move.node',
		payload: {
			id: input.issueId,
			parent: input.parentId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll([event]);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	return succeeded('Moved issue', {
		id: input.issueId,
		parentId: input.parentId,
		position: input.position ?? {at: 'end'},
	});
};

export const sync = async (input: SyncInput = {}) => {
	const epiqRootResult = resolveClosestEpiqRoot(
		input.repoRoot ?? process.cwd(),
	);
	if (isFail(epiqRootResult)) return failed('Sync failed \n' + epiqRootResult);

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const result = await syncEpiqWithRemote({
		cwd: epiqRootResult.value,
		ownEventFileName: getPersistFileName({
			userId: actorResult.value.userId,
			userName: actorResult.value.userName,
		}),
	});
	if (isFail(result)) return result;

	return succeeded('Synced Epiq state', result.value);
};
