import {decodeTime, ulid} from 'ulid';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {ensureStateBranchWorktree} from '../git/git.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {createIssueEvents} from '../lib/event/common-events.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent, MovePosition} from '../lib/event/event.model.js';
import {filterEventsForBoard} from './epiq-time-travel.js';
import {resolveReopenParentFromLog} from '../lib/event/log-utils.js';
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
import {setSynced, setSyncFailed, setSyncing} from '../lib/state/sync-state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	Contributor,
	REMOVED_CONTRIBUTOR_NAME,
} from '../lib/model/app-state.model.js';
import {preferBestName} from '../lib/utils/contributor.utils.js';
import {getStringColor} from '../lib/utils/color.js';
import {nodeRef} from '../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {
	DEFAULT_ATTACHMENT_MAX_KB,
	getAttachmentFileName,
	resolveAttachmentBlob,
	writeAttachmentBlob,
} from '../lib/media/media-store.js';
import {logger} from '../logger.js';
import {
	ApiAssignee,
	ApiIssue,
	ApiState,
	ApiSwimlane,
} from './api-state.model.js';
import {getTimeTravelStatus} from './epiq-time-travel.js';

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
	boardId?: string;
};

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

type CreateIssueInput = ToolInput & {
	title: string;
	parentId: string;
	description?: string;
	tagNames?: string[];
	assigneeNames?: string[];
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
	assigneeId?: string;
	// Resolves to the config userId, the same identity that authors events.
	self?: boolean;
	// Names a person with no contributor record yet; a near-miss spelling makes
	// a second, near-identical contributor.
	assigneeName?: string;
	// Required to create somebody new from a name; without it an unmatched name
	// is refused rather than minting a contributor.
	createUnlinked?: boolean;
};

type RemoveIssueAssigneeInput = ToolInput & {
	issueId: string;
	assigneeId: string;
};

type AddIssueCommentInput = ToolInput & {
	issueId: string;
	body: string;
};

type DeleteIssueCommentInput = ToolInput & {
	commentId: string;
};

type AddIssueAttachmentInput = ToolInput & {
	issueId: string;
	name: string;
	dataBase64: string;
};

type DeleteIssueAttachmentInput = ToolInput & {
	attachmentId: string;
};

type GetAttachmentBlobInput = ToolInput & {
	fileName: string;
};

const getAttachmentMaxKb = (): number => {
	const settings = loadSettingsFromConfig();
	if (isFail(settings)) return DEFAULT_ATTACHMENT_MAX_KB;

	return settings.value.attachmentMaxKb ?? DEFAULT_ATTACHMENT_MAX_KB;
};

const resolveRepoRoot = (repoRoot?: string): Result<string> => {
	const result = resolveClosestEpiqProjectRoot(repoRoot ?? process.cwd());
	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved Epiq repo root', result.value);
};

const boot = async (
	repoRoot?: string,
	options?: {pull?: boolean},
): Promise<Result<BootResult>> => {
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

	// MCP tools are local-only by default; fetching remote state is explicit.
	if (options?.pull ?? false) {
		const pullResult = await execGit({
			cwd: stateBranchRootResult.value,
			args: ['pull', '--ff-only'],
		});

		if (isFail(pullResult)) {
			logger.info(3, pullResult.message);
		}
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

// A contributor node's name is written once at create.contributor and never
// updated; the event log carries the current one.
const getLatestNamesFromLog = (): Map<string, string> => {
	const stateResult = getSafeState();
	const eventLog = isFail(stateResult) ? [] : stateResult.value.eventLog ?? [];
	const byId = new Map<string, string>();

	for (const event of eventLog) {
		if (event.userId && event.userName) byId.set(event.userId, event.userName);
	}

	return byId;
};

// Shared so that every surface offering or matching a contributor agrees on the
// answer; disagreement mints duplicate ids for the same person.
const mergeRegistryNames = (
	logNames: Map<string, string>,
	registry: Record<string, Contributor>,
): Map<string, string> => {
	const byId = new Map(logNames);

	for (const contributor of Object.values(registry)) {
		// Overwrites rather than fills a gap: their events still carry the name
		// they authored under, so the log must never win here.
		if (contributor.tombstoned) {
			byId.set(contributor.id, contributor.name);
			continue;
		}

		// The log's copy is a sanitized file name segment, so it wins only when
		// it is a genuinely different name, not the same one spelled worse.
		byId.set(
			contributor.id,
			preferBestName(contributor.name, byId.get(contributor.id)) ??
				contributor.name,
		);
	}

	return byId;
};

const getIssueAssignees = (
	ticket: Ticket,
	latestNames: Map<string, string> = new Map(),
) =>
	(ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter(contributor => contributor != undefined)
		.map(contributor => {
			// Unconditional for a tombstoned contributor: the log must never be able
			// to put a cleared name back.
			const name = contributor.tombstoned
				? contributor.name
				: preferBestName(contributor.name, latestNames.get(contributor.id)) ??
				  contributor.name;

			return {
				id: contributor.id,
				name,
				color: getStringColor(name),
			} satisfies ApiIssue['assignees'][number];
		});

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

export const listIssues = async (input: ListIssuesInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const nodes = stateResult.value.nodes;
	const latestNames = getLatestNamesFromLog();

	const issues: ApiIssue[] = Object.values(nodes)
		.filter(isTicketNode)
		.filter(n => !n.isDeleted)
		.filter(n => input.includeClosed || n.parentNodeId !== CLOSED_SWIMLANE_ID)
		.filter(n => {
			if (!input.boardId) return true;
			const swimlane = n.parentNodeId ? nodes[n.parentNodeId] : undefined;
			return swimlane?.parentNodeId === input.boardId;
		})
		.map(
			n =>
				({
					id: n.id,
					ref: nodeRef(n.id),
					title: sanitizeInlineText(n.title),
					description: n.props.description ?? '',
					parentNodeId: n.parentNodeId!,
					isClosed: n.parentNodeId === CLOSED_SWIMLANE_ID,
					readonly: Boolean(n.readonly),
					tags: getIssueTags(n),
					assignees: getIssueAssignees(n, latestNames),
				} satisfies ApiIssue),
		);

	return succeeded('Listed issues', issues);
};

export const createIssue = async (input: CreateIssueInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

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

	const events: AppEvent[] = [...issueEventsResult.value];
	const issueId = events.find(e => e.action === 'add.issue')?.payload.id;
	if (!issueId) return failed('Unable to determine created issue id');

	if (input.description) {
		events.push({
			id: ulid(),
			...actorResult.value,
			action: 'edit.description',
			payload: {id: issueId, md: input.description},
		} satisfies AppEvent<'edit.description'>);
	}

	const tags: {id: string; name: string}[] = [];
	for (const rawName of input.tagNames ?? []) {
		const tagName = sanitizeInlineText(rawName).trim();
		if (!tagName || tags.some(tag => tag.name === tagName)) continue;

		const existingTag = Object.values(stateResult.value.tags).find(
			tag => tag.name === tagName,
		);
		const tagId = existingTag?.id ?? ulid();

		if (!existingTag) {
			events.push({
				id: ulid(),
				...actorResult.value,
				action: 'create.tag',
				payload: {id: tagId, name: tagName},
			} satisfies AppEvent<'create.tag'>);
		}

		events.push({
			id: ulid(),
			...actorResult.value,
			action: 'add.issue.tag',
			payload: {id: issueId, tag: tagId},
		} satisfies AppEvent<'add.issue.tag'>);

		tags.push({id: tagId, name: tagName});
	}

	const assignees: {id: string; name: string}[] = [];
	for (const rawName of input.assigneeNames ?? []) {
		const assigneeName = sanitizeInlineText(rawName).trim();
		if (!assigneeName || assignees.some(a => a.name === assigneeName)) {
			continue;
		}

		const existingAssignee = Object.values(stateResult.value.contributors).find(
			contributor => contributor.name === assigneeName,
		);
		const assigneeId = existingAssignee?.id ?? ulid();

		if (!existingAssignee) {
			events.push({
				id: ulid(),
				...actorResult.value,
				action: 'create.contributor',
				payload: {id: assigneeId, name: assigneeName},
			} satisfies AppEvent<'create.contributor'>);
		}

		events.push({
			id: ulid(),
			...actorResult.value,
			action: 'add.issue.assignee',
			payload: {id: issueId, assignee: assigneeId},
		} satisfies AppEvent<'add.issue.assignee'>);

		assignees.push({id: assigneeId, name: assigneeName});
	}

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(results)) return failed(results.message);

	return succeeded('Created issue', {
		id: issueId,
		title: input.title,
		parentId: input.parentId,
		description: input.description ?? '',
		tags,
		assignees,
	});
};

export const closeIssue = async (input: CloseIssueInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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
	if (isFail(results)) return failed(results.message);

	return succeeded('Closed issue', {id: input.issueId});
};

export const reopenIssue = async (input: CloseIssueInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

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
	if (isFail(results)) return failed(results.message);

	return succeeded('Moved issue', {
		id: input.issueId,
		parentId: input.parentId,
	});
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

	const title = sanitizeInlineText(input.title);
	if (!title.trim()) return failed('Swimlane title cannot be empty');

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

	if (swimlane.title === title) {
		return succeeded('No changes made', {
			id: input.swimlaneId,
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

	const eventsResult = loadMergedEvents(stateBranchRootResult.value);
	if (isFail(eventsResult)) return eventsResult;

	const bootStateResult = bootStateFromEventLog(eventsResult.value);
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

	return succeeded('Deleted swimlane', {id: input.swimlaneId});
};

export const sync = async (input: SyncInput = {}) => {
	setSyncing();
	const repoRootResult = resolveRepoRoot(input.repoRoot);
	if (isFail(repoRootResult)) return failed('Sync failed');

	const actor = getActor();
	if (isFail(actor)) return actor;

	const result = await syncEpiqWithRemote({
		cwd: repoRootResult.value,
		ownEventFileName: getPersistFileName(actor.value),
	});

	if (isFail(result)) {
		setSyncFailed(result.message);
		return result;
	}

	setSynced();
	return succeeded('Synced', result.value);
};

export const getEpiqState = async (input: ToolInput = {}) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

// Reads whatever is currently materialized, live or a historical checkout. Must
// never boot: booting discards an active time-travel checkout.
export const deriveGuiState = (): Result<ApiState> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const timeTravel = getTimeTravelStatus();
	const forceReadonly = timeTravel.mode !== 'live';

	const nodes = Object.values(stateResult.value.nodes);
	const boards = nodes.filter(n => isBoardNode(n) && !n.isDeleted);
	const latestNames = getLatestNamesFromLog();

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

	const settingsRes = loadSettingsFromConfig();
	if (isFail(settingsRes)) return settingsRes;

	const commentsByIssueId: ApiState['commentsByIssueId'] = {};

	for (const issue of nodes.filter(isTicketNode)) {
		if (issue.isDeleted) continue;

		commentsByIssueId[issue.id] = nodeRepo
			.getCommentsByIssue(issue.id)
			.map(comment => {
				const contributor = nodeRepo.getContributor(comment.authorId);

				return {
					id: comment.id,
					issueId: comment.issue,
					body: comment.md,
					author: {
						id: comment.authorId,
						name: contributor?.name ?? 'Unknown',
						color: getStringColor(contributor?.name ?? comment.authorId),
					},
					createdAt: decodeTime(comment.id),
				};
			});
	}

	const attachmentOwners = new Map<string, string>();
	for (const event of stateResult.value.eventLog) {
		if (event.action === 'add.issue.attachment') {
			attachmentOwners.set(event.payload.id, event.payload.author);
		}
	}

	const attachmentsByIssueId: ApiState['attachmentsByIssueId'] = {};

	for (const issue of nodes.filter(isTicketNode)) {
		if (issue.isDeleted) continue;

		attachmentsByIssueId[issue.id] = nodeRepo
			.getAttachmentsByIssue(issue.id)
			.map(attachment => ({
				id: attachment.id,
				issueId: attachment.issue,
				name: attachment.name,
				fileName: getAttachmentFileName(attachment.hash, attachment.ext),
				bytes: attachment.bytes,
				createdAt: decodeTime(attachment.id),
				canDelete:
					attachmentOwners.get(attachment.id) === settingsRes.value.userId,
			}));
	}

	return succeeded('Retrieved Epiq GUI state', {
		boards: boards
			.sort((a, b) => a.rank.localeCompare(b.rank))
			.map(b => ({
				id: b.id,
				ref: nodeRef(b.id),
				title: b.title,
				swimlanes: (swimlanesByBoardId.get(b.id) ?? [])
					.sort((a, b) => a.rank.localeCompare(b.rank))
					.map(
						swimlane =>
							({
								id: swimlane.id,
								title: swimlane.title,
								readonly: Boolean(swimlane.readonly) || forceReadonly,
								issues: (ticketsBySwimlaneId.get(swimlane.id) ?? [])
									.sort((a, b) => a.rank.localeCompare(b.rank))
									.map(issue => ({
										id: issue.id,
										ref: nodeRef(issue.id),
										title: sanitizeInlineText(issue.title),
										description: issue.props.description ?? '',
										readonly: Boolean(issue.readonly) || forceReadonly,
										tags: getIssueTags(issue),
										assignees: getIssueAssignees(issue, latestNames),
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
		user: {
			name: settingsRes.value.userName ?? '',
			id: settingsRes.value.userId ?? '',
			color: getStringColor(settingsRes.value.userName ?? ''),
		},
		commentsByIssueId,
		attachmentsByIssueId,
		attachmentMaxKb: getAttachmentMaxKb(),
		timeTravel,
	} satisfies ApiState);
};

export const getGuiState = async (
	input: ToolInput = {},
): Promise<Result<ApiState>> => {
	// Fast path; the guarantee that a checkout survives a boot lives in
	// `bootStateFromEventLog`, not here.
	if (getTimeTravelStatus().mode !== 'live') {
		return deriveGuiState();
	}

	// Never pull on a read: it would hang sandboxed or offline setups. Freshness
	// is an explicit periodic sync's job.
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	return deriveGuiState();
};

export const editIssueDescription = async (
	input: EditIssueDescriptionInput,
) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Edited issue description', {
		id: input.issueId,
		description: input.description,
	});
};

export const editIssueTitle = async (input: EditIssueTitleInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Edited issue title', {
		id: input.issueId,
		title,
	});
};

export const addIssueTag = async (input: AddIssueTagInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue tag', {
		id: input.issueId,
		tag: {id: tagId, name: tagName},
	});
};

export const removeIssueTag = async (input: RemoveIssueTagInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Removed issue tag', {
		id: input.issueId,
		tagId: input.tagId,
	});
};

const findEventLogAuthor = async (
	stateBranchRoot: string,
	userId: string,
): Promise<{id: string; name: string} | undefined> => {
	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return undefined;

	let name: string | undefined;

	// Last write wins: a display name changes over time, the id does not.
	for (const event of eventsResult.value) {
		if (event.userId === userId) name = event.userName ?? name;
	}

	return name === undefined ? undefined : {id: userId, name};
};

export const addIssueAssignee = async (input: AddIssueAssigneeInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Assign target must be an issue');
	if (issue.readonly) return failed('Cannot assign readonly issue');

	const targetId = input.self ? actorResult.value.userId : input.assigneeId;

	// An id names a specific person, so an unknown one is an error rather than
	// an invitation to invent a contributor.
	if (targetId) {
		const registered = stateResult.value.contributors[targetId];

		// A contributor node is only written when somebody is explicitly created
		// or assigned, so an author who was never assigned is absent from the
		// registry. Register them under the id they already author with.
		const authored = registered
			? undefined
			: await findEventLogAuthor(bootResult.value.stateBranchRoot, targetId);

		if (!registered && !authored) return failed('Unknown assignee id');

		const assignee = registered ?? authored!;

		const events = [
			...(registered
				? []
				: [
						{
							id: ulid(),
							...actorResult.value,
							action: 'create.contributor',
							payload: {id: assignee.id, name: assignee.name},
						} satisfies AppEvent<'create.contributor'>,
				  ]),
			{
				id: ulid(),
				...actorResult.value,
				action: 'add.issue.assignee',
				payload: {id: input.issueId, assignee: assignee.id},
			} satisfies AppEvent<'add.issue.assignee'>,
		];

		const assignResults = materializeAndPersistAll(
			events,
			bootResult.value.stateBranchRoot,
		);

		if (isFail(assignResults)) return failed(assignResults.message);

		return succeeded('Added issue assignee', {
			id: input.issueId,
			assignee: {id: assignee.id, name: assignee.name},
		});
	}

	const assigneeName = sanitizeInlineText(input.assigneeName ?? '').trim();
	if (!assigneeName) return failed('Provide assigneeId, self or assigneeName');

	// Registry *and* event log, so this matches the same union a picker offers;
	// the registry alone reports log-only authors as unknown.
	const candidates = mergeRegistryNames(
		getLatestNamesFromLog(),
		stateResult.value.contributors,
	);

	const matches = [...candidates.entries()].filter(
		([, candidateName]) => candidateName === assigneeName,
	);

	// Two people can share a display name; picking one silently assigns the
	// wrong person half the time.
	if (matches.length > 1) {
		return failed(
			`"${assigneeName}" matches ${matches.length} contributors (${matches
				.map(([id]) => id)
				.join(', ')}). Assign by assigneeId to choose.`,
		);
	}

	const match = matches[0];

	if (!match && !input.createUnlinked) {
		return failed(
			`No contributor named "${assigneeName}". Assign by id, or pass createUnlinked to add them as an external assignee.`,
		);
	}

	const [assigneeId = ulid(), resolvedName = assigneeName] = match ?? [];

	// Keyed on the registry, not on whether a name matched: somebody found only
	// in the event log still needs a contributor record.
	const isRegistered = Boolean(stateResult.value.contributors[assigneeId]);

	const events = [
		...(isRegistered
			? []
			: [
					{
						id: ulid(),
						...actorResult.value,
						action: 'create.contributor',
						payload: {
							id: assigneeId,
							name: resolvedName,
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue assignee', {
		id: input.issueId,
		assignee: {id: assigneeId, name: resolvedName},
	});
};

// Tombstone, not deletion: the id and every reference to it survive, so only
// the display name stops rendering. Refused for anyone who has authored an
// event, since the log names them throughout and is never rewritten.
export const tombstoneContributor = async (
	input: ToolInput & {contributorId: string},
): Promise<Result<{id: string; name: string}>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const contributor = stateResult.value.contributors[input.contributorId];
	if (!contributor) return failed('Contributor not found');

	const authored = await findEventLogAuthor(
		bootResult.value.stateBranchRoot,
		input.contributorId,
	);

	if (authored) {
		return failed(
			'Cannot remove a contributor who has authored events — their name appears throughout the log',
		);
	}

	const events = [
		{
			id: ulid(),
			...actorResult.value,
			action: 'tombstone.contributor',
			payload: {id: input.contributorId},
		} satisfies AppEvent<'tombstone.contributor'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Tombstoned contributor', {
		id: input.contributorId,
		name: REMOVED_CONTRIBUTOR_NAME,
	});
};

// Removal never rewrites the log, so the `create.contributor` payload still
// carries the original name. Last write wins.
const findCreatedContributorName = async (
	stateBranchRoot: string,
	contributorId: string,
): Promise<string | undefined> => {
	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return undefined;

	let name: string | undefined;

	for (const event of eventsResult.value) {
		if (event.action !== 'create.contributor') continue;

		const payload = event.payload as {id?: string; name?: string};
		if (payload.id === contributorId && payload.name) name = payload.name;
	}

	return name;
};

// The removal guard only sees the log this machine has pulled, so somebody
// whose events have not arrived yet can be cleared by mistake. This makes that
// reversible rather than forcing a network round-trip inside a read path.
export const restoreContributor = async (
	input: ToolInput & {contributorId: string},
): Promise<Result<{id: string; name: string}>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const contributor = stateResult.value.contributors[input.contributorId];
	if (!contributor) return failed('Contributor not found');

	if (!contributor.tombstoned) {
		return failed('Contributor is not tombstoned');
	}

	const originalName = await findCreatedContributorName(
		bootResult.value.stateBranchRoot,
		input.contributorId,
	);

	if (!originalName) {
		return failed(
			'Cannot restore this contributor — no original name found in the event log',
		);
	}

	const events = [
		{
			id: ulid(),
			...actorResult.value,
			action: 'restore.contributor',
			payload: {id: input.contributorId, name: originalName},
		} satisfies AppEvent<'restore.contributor'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Restored contributor', {
		id: input.contributorId,
		name: originalName,
	});
};

export const getBoardContributors = async (
	input: ToolInput & {boardId?: string} = {},
): Promise<
	Result<
		(ApiAssignee & {
			isSelf: boolean;
			isExternal: boolean;
			isRemoved: boolean;
			hasAuthoredAnywhere: boolean;
		})[]
	>
> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const eventsResult = loadMergedEvents(bootResult.value.stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const scopedEvents = input.boardId
		? filterEventsForBoard(eventsResult.value, input.boardId)
		: eventsResult.value;

	// Last write wins: events arrive in chronological order.
	const byId = new Map<string, string>();
	// Board-scoped, and kept apart from the merged map so the union below cannot
	// erase "has actually worked on this board".
	const authorIds = new Set<string>();

	// Unfiltered, unlike `authorIds`: removal is refused for anyone who has
	// authored anywhere, so this must read the same events that guard does.
	const workspaceAuthorIds = new Set<string>();

	for (const event of eventsResult.value) {
		if (event.userId) workspaceAuthorIds.add(event.userId);
	}

	for (const event of scopedEvents) {
		if (!event.userId) continue;

		byId.set(event.userId, event.userName ?? '');
		authorIds.add(event.userId);
	}

	const registry = stateResult.value.contributors;
	const namesById = mergeRegistryNames(byId, registry);

	const contributors = [...namesById.entries()].map(([id, name]) => ({
		id,
		name,
		color: getStringColor(name),
		isSelf: id === actorResult.value.userId,
		// Board-scoped: means "has not worked on this board", not "is not in the
		// history". Never stored, so it self-corrects.
		isExternal: !authorIds.has(id),
		// Read off the record, not compared against the placeholder name, so
		// somebody genuinely called "removed" is not reported as already removed.
		isRemoved: registry[id]?.tombstoned === true,
		// Workspace-wide: their name is in the log, which is what blocks removal.
		hasAuthoredAnywhere: workspaceAuthorIds.has(id),
	}));

	return succeeded('Listed board contributors', contributors);
};

export const removeIssueAssignee = async (input: RemoveIssueAssigneeInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
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

	if (isFail(results)) return failed(results.message);

	return succeeded('Removed issue assignee', {
		id: input.issueId,
		assigneeId: input.assigneeId,
	});
};

export const addIssueComment = async (input: AddIssueCommentInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Comment target must be an issue');
	if (issue.readonly) return failed('Cannot comment on readonly issue');

	const body = input.body.trim();

	if (!body) {
		return failed('Comment cannot be empty');
	}

	const commentId = ulid();

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'add.issue.comment',
		payload: {
			id: commentId,
			issue: input.issueId,
			md: body,
			author: actorResult.value.userId,
		},
	} satisfies AppEvent<'add.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue comment', {
		id: commentId,
		issueId: input.issueId,
		body,
	});
};

export const deleteIssueComment = async (input: DeleteIssueCommentInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const commentEvent = stateResult.value.eventLog.find(
		(event): event is AppEvent<'add.issue.comment'> =>
			event.action === 'add.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (!commentEvent) {
		return failed('Unable to resolve comment');
	}

	if (commentEvent.payload.author !== actorResult.value.userId) {
		return failed('You can only delete your own comments');
	}

	const issue = stateResult.value.nodes[commentEvent.payload.issue];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Comment target must be an issue');
	if (issue.readonly) return failed('Cannot delete comment on readonly issue');

	const alreadyDeleted = stateResult.value.eventLog.some(
		event =>
			event.action === 'delete.issue.comment' &&
			event.payload.id === input.commentId,
	);

	if (alreadyDeleted) {
		return succeeded('Comment already deleted', {
			id: input.commentId,
			issueId: commentEvent.payload.issue,
		});
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'delete.issue.comment',
		payload: {
			id: input.commentId,
			issue: commentEvent.payload.issue,
		},
	} satisfies AppEvent<'delete.issue.comment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted issue comment', {
		id: input.commentId,
		issueId: commentEvent.payload.issue,
	});
};

export const addIssueAttachment = async (input: AddIssueAttachmentInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[input.issueId];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Attachment target must be an issue');
	if (issue.readonly) return failed('Cannot attach to readonly issue');

	const data = Buffer.from(input.dataBase64 ?? '', 'base64');

	const written = writeAttachmentBlob(
		bootResult.value.stateBranchRoot,
		data,
		getAttachmentMaxKb(),
	);
	if (isFail(written)) return written;

	const name = sanitizeInlineText(input.name ?? '').trim() || 'image';
	const attachmentId = ulid();

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'add.issue.attachment',
		payload: {
			id: attachmentId,
			issue: input.issueId,
			author: actorResult.value.userId,
			hash: written.value.hash,
			ext: written.value.ext,
			name,
			bytes: written.value.bytes,
		},
	} satisfies AppEvent<'add.issue.attachment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue attachment', {
		id: attachmentId,
		issueId: input.issueId,
		fileName: getAttachmentFileName(written.value.hash, written.value.ext),
		bytes: written.value.bytes,
	});
};

export const deleteIssueAttachment = async (
	input: DeleteIssueAttachmentInput,
) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const attachmentEvent = stateResult.value.eventLog.find(
		(event): event is AppEvent<'add.issue.attachment'> =>
			event.action === 'add.issue.attachment' &&
			event.payload.id === input.attachmentId,
	);

	if (!attachmentEvent) {
		return failed('Unable to resolve attachment');
	}

	if (attachmentEvent.payload.author !== actorResult.value.userId) {
		return failed('You can only delete your own attachments');
	}

	const issue = stateResult.value.nodes[attachmentEvent.payload.issue];

	if (!issue) return failed('Issue not found');
	if (!isTicketNode(issue)) return failed('Attachment target must be an issue');
	if (issue.readonly) {
		return failed('Cannot delete attachment on readonly issue');
	}

	const alreadyDeleted = stateResult.value.eventLog.some(
		event =>
			event.action === 'delete.issue.attachment' &&
			event.payload.id === input.attachmentId,
	);

	if (alreadyDeleted) {
		return succeeded('Attachment already deleted', {
			id: input.attachmentId,
			issueId: attachmentEvent.payload.issue,
		});
	}

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'delete.issue.attachment',
		payload: {
			id: input.attachmentId,
			issue: attachmentEvent.payload.issue,
		},
	} satisfies AppEvent<'delete.issue.attachment'>;

	const results = materializeAndPersistAll(
		[event],
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted issue attachment', {
		id: input.attachmentId,
		issueId: attachmentEvent.payload.issue,
	});
};

/**
 * Synced blobs are untrusted input; `resolveAttachmentBlob` does the name,
 * hash, and magic-byte validation.
 */
export const getAttachmentBlob = async (input: GetAttachmentBlobInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	return resolveAttachmentBlob(
		bootResult.value.stateBranchRoot,
		input.fileName,
		getAttachmentMaxKb(),
	);
};
