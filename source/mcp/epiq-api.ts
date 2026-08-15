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
	REDACTED_CONTRIBUTOR_NAME,
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
	// Prefer this. Assignees are stored as contributor ids, so an id assigns
	// exactly who you meant.
	assigneeId?: string;
	// Assign whoever is running this. Resolves to the config userId, which is
	// the same identity that authors every event — so an assignment made this
	// way is bound to your history rather than to a lookalike record.
	self?: boolean;
	// The unlinked/ad-hoc path: names a person who has no contributor record
	// yet. Kept because assigning someone outside the board is legitimate, but
	// it is the unorthodox route — a name that differs only in case or spacing
	// from an existing contributor produces a second, near-identical one.
	assigneeName?: string;
	// Required to create somebody new from a name. Without it an unmatched
	// name is refused rather than quietly minting a contributor: creating a
	// person should be a decision, not the accidental outcome of a typo.
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

	// MCP tools default to local-only. Fetching remote state is explicit via
	// the `sync` tool (and the GUI's own autosync loop, see api-autosync.ts).
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
// updated, so it goes stale the moment somebody changes their display name.
// The event log always carries the current one, which is why the picker and
// the assignee chip could show two different names for the same person.
//
// Built from state rather than re-read from disk, and computed once per
// listing rather than per ticket.
const getLatestNamesFromLog = (): Map<string, string> => {
	const stateResult = getSafeState();
	const eventLog = isFail(stateResult) ? [] : stateResult.value.eventLog ?? [];
	const byId = new Map<string, string>();

	for (const event of eventLog) {
		if (event.userId && event.userName) byId.set(event.userId, event.userName);
	}

	return byId;
};

// Folds the contributor registry into a map of log-derived names, resolving
// each collision with `preferBestName`.
//
// Extracted because three surfaces have to agree on the answer: the picker
// (`getBoardContributors`), name-based assignment (`addIssueAssignee`), and the
// TUI's own `getAssignableContributors`. While assignment matched the registry
// alone, the picker could offer a name that assignment then called unknown —
// and `createUnlinked` minted a second id for somebody who already had one.
const mergeRegistryNames = (
	logNames: Map<string, string>,
	registry: Record<string, Contributor>,
): Map<string, string> => {
	const byId = new Map(logNames);

	for (const contributor of Object.values(registry)) {
		// A redacted contributor overwrites whatever the log supplied instead of
		// only filling a gap: their events still carry the name they authored
		// under, and the log seeded this map from those events.
		if (contributor.redacted) {
			byId.set(contributor.id, contributor.name);
			continue;
		}

		// Otherwise the log wins only when it is a *different* name, not merely
		// the same one spelled worse — its copy is a sanitized file name
		// segment. Covers the gap-filling case too: `preferBestName` returns the
		// registry name when the log has nothing for this id.
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
			// Registry wins for anyone with no events, and unconditionally for a
			// redacted contributor — see getContributorDisplayName for why the
			// log must never be able to put a cleared name back.
			const name = contributor.redacted
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

// Derives ApiState from whatever is currently materialized in the state
// singleton — live or a historical time-travel checkout — without booting
// (re-pulling and re-materializing live state). `getGuiState` below is the
// live-reading entry point most callers want; time-travel handlers call this
// directly after a checkout so `boot()` doesn't stomp the historical view.
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
	// Fast path only: skips the worktree/repo-root work for the common case of
	// a client polling state while scrubbing. The actual guarantee that a
	// checkout survives lives in `bootStateFromEventLog`, which every one of
	// these entry points funnels through — see the note there for why it
	// belongs at the choke point instead of at each call site.
	if (getTimeTravelStatus().mode !== 'live') {
		return deriveGuiState();
	}

	// Multi-user freshness is handled by api-autosync.ts's own explicit
	// sync() on an interval, not by pulling here — forcing a pull on every
	// read would hang/break sandboxed or offline setups with no network.
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

// Looks an id up among the people who have authored events. Used when the
// contributor registry doesn't know them yet — see the fallback in
// addIssueAssignee for why that's the normal case rather than the odd one.
const findEventLogAuthor = async (
	stateBranchRoot: string,
	userId: string,
): Promise<{id: string; name: string} | undefined> => {
	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return undefined;

	let name: string | undefined;

	// Last write wins: a display name changes over time, the id doesn't.
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

	// `self` is just sugar for "the id I author events with" — resolving it
	// here rather than making every caller read the config keeps the binding
	// between assignment identity and authorship identity in one place.
	const targetId = input.self ? actorResult.value.userId : input.assigneeId;

	// An id must resolve to somebody who already exists — unlike the name path
	// below, an unknown id is an error rather than an invitation to invent a
	// contributor. A caller passing an id is saying "this specific person",
	// and silently creating a different one would answer a question they
	// didn't ask.
	if (targetId) {
		const registered = stateResult.value.contributors[targetId];

		// Not being in the registry doesn't mean the person doesn't exist: a
		// contributor node is only written when somebody is explicitly created
		// or assigned, so anyone who has authored events but never been
		// assigned — including you, the first time — is absent from it. Fall
		// back to the event log, and register them under the id they already
		// author with rather than minting a second one.
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

	// Matched against the same union the picker offers — registry *and* event
	// log — not the registry alone. A contributor record is only written when
	// somebody is explicitly created or assigned, so an author who has never
	// been assigned is absent from it; matching the registry alone reported
	// them unknown, and `createUnlinked` then minted a second id for a person
	// who already had one.
	const candidates = mergeRegistryNames(
		getLatestNamesFromLog(),
		stateResult.value.contributors,
	);

	const matches = [...candidates.entries()].filter(
		([, candidateName]) => candidateName === assigneeName,
	);

	// Two people can share a display name; picking one silently would assign
	// the wrong person half the time. Mirrors the TUI's `:assign`, which
	// refuses the same way.
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

	// Keyed on the *registry*, not on whether a name matched: somebody found
	// only in the event log still needs a contributor record — written under
	// the id they already author with rather than a fresh one.
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

// Who can be assigned. Deliberately not just the contributor registry: a
// contributor node only comes into existence when somebody is explicitly
// created or assigned, so on a board where nobody has been assigned yet that
// registry is empty — including you, despite having authored every event on
// it. Every event carries userId + userName, so the people who have actually
// touched a board are derivable, and derivable by id rather than by name.
//
// The two sources are unioned rather than one replacing the other: the
// registry can hold people who were assigned but never authored anything
// (external/unlinked assignees), and the log holds people who authored but
// were never assigned.
// Clears a contributor's display name. Redaction, not deletion: the id and
// every reference to it survive, so assignments keep resolving and the event
// log stays intact — only the personal name stops rendering.
//
// Restricted to people who have never authored an event. Someone who has is
// named throughout the log by their own events, and clearing only the
// registry copy would leave the two disagreeing rather than removing
// anything.
export const redactContributor = async (
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
			'Cannot redact a contributor who has authored events — their name appears throughout the log',
		);
	}

	const events = [
		{
			id: ulid(),
			...actorResult.value,
			action: 'redact.contributor',
			payload: {id: input.contributorId},
		} satisfies AppEvent<'redact.contributor'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Redacted contributor', {
		id: input.contributorId,
		name: REDACTED_CONTRIBUTOR_NAME,
	});
};

export const getBoardContributors = async (
	input: ToolInput & {boardId?: string} = {},
): Promise<
	Result<
		(ApiAssignee & {
			isSelf: boolean;
			isExternal: boolean;
			isRedacted: boolean;
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

	// Last write wins on the name: a display name can change over time while
	// the id it belongs to does not, so the most recent spelling is the one
	// worth showing. Events arrive in chronological order.
	const byId = new Map<string, string>();
	// Tracked separately from the merged map so "has this person actually
	// worked on the board" survives the union below — that is precisely what
	// distinguishes a real contributor from an external one.
	const authorIds = new Set<string>();

	// Deliberately unfiltered, unlike `authorIds`. Redaction is refused for
	// anyone who has authored anywhere (redactContributor's guard scans the
	// whole merged log via findEventLogAuthor), so answering "can this name be
	// cleared" with a board-scoped set offered candidates the server then
	// refused — and the refusal was invisible. Same event source as the guard,
	// so the two cannot drift.
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

	// Both flags are derived here rather than left to callers: every surface
	// wants to pin "me" first and mark outsiders, and three of them working it
	// out independently is three chances to disagree.
	//
	// `isExternal` is computed, never stored, so it self-corrects — the day an
	// external assignee authors their first event on this board they stop
	// being external, with nothing to migrate.
	const contributors = [...namesById.entries()].map(([id, name]) => ({
		id,
		name,
		color: getStringColor(name),
		isSelf: id === actorResult.value.userId,
		isExternal: !authorIds.has(id),
		// Read off the record rather than compared against the placeholder
		// string, so somebody genuinely called "removed" isn't reported as
		// already-cleared (and so made un-redactable by the modal).
		isRedacted: registry[id]?.redacted === true,
		// Workspace-wide, so it answers the question redaction actually asks.
		// `isExternal` is board-scoped and means something else: not "their name
		// is in the history" but "they have not worked on this board".
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
 * Resolves a content-addressed blob for serving. Validation (name shape,
 * hash match, magic bytes) happens inside resolveAttachmentBlob — synced
 * blobs are untrusted input.
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
