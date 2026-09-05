import {ulid} from 'ulid';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {createIssueEvents} from '../../lib/event/common-events.js';
import {ulidTimeMs} from '../../lib/event/date-utils.js';
import {bootStateFromEventLog} from '../../lib/event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../../lib/event/event-load.js';
import {materializeAndPersistAll} from '../../lib/event/event-materialize-and-persist.js';
import {AppEvent, MovePosition} from '../../lib/event/event.model.js';
import {resolveReopenParentFromLog} from '../../lib/event/log-utils.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/event/static-ids.js';
import {isTicketNode, Ticket} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../../lib/repository/rank.js';
import {describeEvent} from '../../lib/event/format-log-utils.js';
import {getStringColor} from '../../lib/utils/color.js';
import {
	MAX_ASSIGNEE_NAME_LENGTH,
	MAX_ASSIGNEES_PER_CREATE,
	MAX_DESCRIPTION_LENGTH,
	MAX_TAG_NAME_LENGTH,
	MAX_TAGS_PER_CREATE,
	MAX_TITLE_LENGTH,
	tooLong,
} from '../../lib/utils/text.limits.js';
import {nodeRef, nodeRefMatches} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {
	ApiBatchOutcome,
	ApiIssue,
	ApiIssueBrief,
	ApiIssueDetail,
	ApiIssueHistoryEntry,
} from '../api-state.model.js';
import {
	ToolInput,
	Actor,
	resolveRepoRoot,
	boot,
	getActor,
	getStateResult,
} from './boot.js';
import {
	getIssueTags,
	getIssueComments,
	getIssueAssignees,
	IssueTargets,
	IssueRef,
	targetIds,
	batchResult,
	forEachTarget,
	findWritableIssue,
} from './issue-helpers.js';

type MoveIssueInput = ToolInput &
	IssueTargets & {
		parentId: string;
		position?: MovePosition;
	};

type ListIssuesInput = ToolInput & {
	includeClosed?: boolean;
	boardId?: string;
	swimlaneId?: string;
	tag?: string;
	assignee?: string;
	query?: string;
	brief?: boolean;
};

type CreateIssueInput = ToolInput & {
	title: string;
	parentId: string;
	description?: string;
	tagNames?: string[];
	assigneeNames?: string[];
};

type CloseIssueInput = ToolInput & IssueTargets;

type EditIssueDescriptionInput = ToolInput & {
	issueId: string;
	description: string;
};

type EditIssueTitleInput = ToolInput & {
	issueId: string;
	title: string;
};

type GetIssueInput = ToolInput & {
	idOrRef: string;
};

/**
 * One issue, by full id or by the 7-character ref the commit convention uses.
 *
 * The inverse of that convention had no tool: going from a ref back to a
 * ticket meant listing the whole board and filtering, and on a board of any
 * age that response is large enough to be unusable for reading one field.
 */
export const getIssue = async (input: GetIssueInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const query = input.idOrRef.trim();
	if (!query) return failed('Provide an issue id or ref');

	const tickets = Object.values(stateResult.value.nodes)
		.filter(isTicketNode)
		.filter(n => !n.isDeleted);

	const exact = tickets.find(n => n.id === query);

	// `nodeRefMatches` is a substring match, so a short query can legitimately
	// hit several tickets. Naming them beats guessing.
	const matches = exact
		? [exact]
		: tickets.filter(n => nodeRefMatches(n.id, query));

	if (matches.length === 0) {
		return failed(`No issue matches "${query}"`);
	}

	if (matches.length > 1) {
		return failed(
			`"${query}" matches ${matches.length} issues: ${matches
				.map(n => `${nodeRef(n.id)} (${sanitizeInlineText(n.title)})`)
				.join(', ')}. Use a full ref or id.`,
		);
	}

	const issue = matches[0] as Ticket;

	return succeeded('Found issue', {
		id: issue.id,
		ref: nodeRef(issue.id),
		title: sanitizeInlineText(issue.title),
		description: issue.props.description ?? '',
		createdAt: ulidTimeMs(issue.id),
		parentNodeId: issue.parentNodeId!,
		isClosed: issue.parentNodeId === CLOSED_SWIMLANE_ID,
		readonly: Boolean(issue.readonly),
		tags: getIssueTags(issue),
		assignees: getIssueAssignees(issue),
		comments: getIssueComments(issue.id),
	} satisfies ApiIssueDetail);
};

const sameName = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

export function listIssues(
	input: ListIssuesInput & {brief: true},
): Promise<Result<ApiIssueBrief[]>>;
export function listIssues(input: ListIssuesInput): Promise<Result<ApiIssue[]>>;
export async function listIssues(
	input: ListIssuesInput,
): Promise<Result<ApiIssue[] | ApiIssueBrief[]>> {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const nodes = stateResult.value.nodes;
	const query = input.query?.trim().toLowerCase();

	const tickets = Object.values(nodes)
		.filter(isTicketNode)
		.filter(n => !n.isDeleted)
		.filter(n => input.includeClosed || n.parentNodeId !== CLOSED_SWIMLANE_ID)
		.filter(n => {
			if (!input.boardId) return true;
			const swimlane = n.parentNodeId ? nodes[n.parentNodeId] : undefined;
			return swimlane?.parentNodeId === input.boardId;
		})
		.filter(n => !input.swimlaneId || n.parentNodeId === input.swimlaneId)
		.filter(
			n =>
				!input.tag ||
				getIssueTags(n).some(tag => sameName(tag.name, input.tag!)),
		)
		.filter(
			n =>
				!input.assignee ||
				getIssueAssignees(n).some(a => sameName(a.name, input.assignee!)),
		)
		.filter(
			n =>
				!query ||
				n.title.toLowerCase().includes(query) ||
				(n.props.description ?? '').toLowerCase().includes(query),
		);

	const swimlaneTitle = (n: Ticket) =>
		sanitizeInlineText(
			(n.parentNodeId ? nodes[n.parentNodeId]?.title : undefined) ?? '',
		);

	if (input.brief) {
		return succeeded(
			'Listed issues',
			tickets.map(
				n =>
					({
						id: n.id,
						ref: nodeRef(n.id),
						title: sanitizeInlineText(n.title),
						swimlane: swimlaneTitle(n),
						tags: getIssueTags(n).map(tag => tag.name),
						assignees: getIssueAssignees(n).map(a => a.name),
					} satisfies ApiIssueBrief),
			),
		);
	}

	return succeeded(
		'Listed issues',
		tickets.map(
			n =>
				({
					id: n.id,
					ref: nodeRef(n.id),
					title: sanitizeInlineText(n.title),
					description: n.props.description ?? '',
					createdAt: ulidTimeMs(n.id),
					parentNodeId: n.parentNodeId!,
					isClosed: n.parentNodeId === CLOSED_SWIMLANE_ID,
					readonly: Boolean(n.readonly),
					tags: getIssueTags(n),
					assignees: getIssueAssignees(n),
				} satisfies ApiIssue),
		),
	);
}

export const createIssue = async (input: CreateIssueInput) => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	// The other three title paths all sanitize; this one used to write the raw
	// input, so a newline or a control character landed in the log for good.
	const title = sanitizeInlineText(input.title);

	if (!title) {
		return failed('Issue title cannot be empty');
	}

	const description = input.description ?? '';

	const overLong =
		tooLong('Issue title', title, MAX_TITLE_LENGTH) ??
		tooLong('Issue description', description, MAX_DESCRIPTION_LENGTH);
	if (overLong) return failed(overLong);

	if ((input.tagNames?.length ?? 0) > MAX_TAGS_PER_CREATE) {
		return failed(`Cannot set more than ${MAX_TAGS_PER_CREATE} tags at once`);
	}

	if ((input.assigneeNames?.length ?? 0) > MAX_ASSIGNEES_PER_CREATE) {
		return failed(
			`Cannot set more than ${MAX_ASSIGNEES_PER_CREATE} assignees at once`,
		);
	}

	const rankResult = resolveAndPersistRankForCreate(
		input.parentId,
		actorResult.value,
		bootResult.value.stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const issueEventsResult = createIssueEvents({
		name: title,
		parent: input.parentId,
		user: actorResult.value,
		rank: rankResult.value,
	});
	if (isFail(issueEventsResult)) return issueEventsResult;

	const events: AppEvent[] = [...issueEventsResult.value];
	const issueId = events.find(e => e.action === 'add.issue')?.payload.id;
	if (!issueId) return failed('Unable to determine created issue id');

	if (description) {
		events.push({
			id: ulid(),
			...actorResult.value,
			action: 'edit.description',
			payload: {id: issueId, md: description},
		} satisfies AppEvent<'edit.description'>);
	}

	const tags: {id: string; name: string}[] = [];
	for (const rawName of input.tagNames ?? []) {
		const tagName = sanitizeInlineText(rawName).trim();
		if (!tagName || tags.some(tag => tag.name === tagName)) continue;

		const overLongTag = tooLong('Tag name', tagName, MAX_TAG_NAME_LENGTH);
		if (overLongTag) return failed(overLongTag);

		const existingTag = nodeRepo.findTagByName(tagName);
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

		const overLongName = tooLong(
			'Assignee name',
			assigneeName,
			MAX_ASSIGNEE_NAME_LENGTH,
		);
		if (overLongName) return failed(overLongName);

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
		ref: nodeRef(issueId),
		title,
		parentId: input.parentId,
		description,
		tags,
		assignees,
	});
};

const closeOne = (id: string, actor: Actor, stateBranchRoot: string) => {
	const issueResult = findWritableIssue(id);
	if (isFail(issueResult)) return issueResult;

	const rankResult = resolveAndPersistRankForMove(
		CLOSED_SWIMLANE_ID,
		id,
		{at: 'end'},
		actor,
		stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actor,
		action: 'close.issue',
		payload: {
			id,
			parent: CLOSED_SWIMLANE_ID,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'close.issue'>;

	const results = materializeAndPersistAll([event], stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Closed issue', {id, ref: nodeRef(id)});
};

export function closeIssue(
	input: CloseIssueInput & {issueIds: string[]},
): Promise<Result<ApiBatchOutcome>>;
export function closeIssue(input: CloseIssueInput): Promise<Result<IssueRef>>;
export async function closeIssue(
	input: CloseIssueInput,
): Promise<Result<ApiBatchOutcome | IssueRef>> {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const idsResult = targetIds(input);
	if (isFail(idsResult)) return idsResult;

	const close = (id: string) =>
		closeOne(id, actorResult.value, bootResult.value.stateBranchRoot);

	if (!input.issueIds) return close(idsResult.value[0]!);

	return batchResult('Closed', forEachTarget(idsResult.value, close));
}

export const reopenIssue = async (input: ToolInput & {issueId: string}) => {
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
		ref: nodeRef(issue.id),
		parentId: previousParent.id,
	});
};

const moveOne = (
	id: string,
	input: MoveIssueInput,
	actor: Actor,
	stateBranchRoot: string,
) => {
	const issueResult = findWritableIssue(id);
	if (isFail(issueResult)) return issueResult;

	const rankResult = resolveAndPersistRankForMove(
		input.parentId,
		id,
		input.position ?? {at: 'end'},
		actor,
		stateBranchRoot,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actor,
		action: 'move.node',
		payload: {
			id,
			parent: input.parentId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll([event], stateBranchRoot);
	if (isFail(results)) return failed(results.message);

	return succeeded('Moved issue', {
		id,
		ref: nodeRef(id),
		parentId: input.parentId,
	});
};

export function moveIssue(
	input: MoveIssueInput & {issueIds: string[]},
): Promise<Result<ApiBatchOutcome>>;
export function moveIssue(
	input: MoveIssueInput,
): Promise<Result<IssueRef & {parentId: string}>>;
export async function moveIssue(
	input: MoveIssueInput,
): Promise<Result<ApiBatchOutcome | (IssueRef & {parentId: string})>> {
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

	const idsResult = targetIds(input);
	if (isFail(idsResult)) return idsResult;

	const move = (id: string) =>
		moveOne(id, input, actorResult.value, stateBranchRootResult.value);

	if (!input.issueIds) return move(idsResult.value[0]!);

	return batchResult('Moved', forEachTarget(idsResult.value, move));
}

/**
 * A ticket's own event log, oldest first. Reads whatever is materialized rather
 * than booting, so it stays correct mid-scrub like the state beside it.
 */
export const getIssueHistory = (
	issueId: string,
): Result<ApiIssueHistoryEntry[]> => {
	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const issue = stateResult.value.nodes[issueId];
	if (!issue) return failed('Issue not found');

	return succeeded(
		'Read issue history',
		(issue.log ?? []).map(event => ({
			id: event.id,
			t: ulidTimeMs(event.id),
			action: event.action,
			label: describeEvent(event),
			actor: {
				id: event.userId,
				name: event.userName,
				color: getStringColor(event.userName),
			},
		})),
	);
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

	const overLongDescription = tooLong(
		'Issue description',
		input.description,
		MAX_DESCRIPTION_LENGTH,
	);
	if (overLongDescription) return failed(overLongDescription);

	const currentDescription = issue.props.description ?? '';

	if (currentDescription === input.description) {
		return succeeded('No changes made', {
			id: input.issueId,
			ref: nodeRef(input.issueId),
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
		ref: nodeRef(input.issueId),
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

	const overLongTitle = tooLong('Issue title', title, MAX_TITLE_LENGTH);
	if (overLongTitle) return failed(overLongTitle);

	if (issue.title === title) {
		return succeeded('No changes made', {
			id: input.issueId,
			ref: nodeRef(input.issueId),
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
		ref: nodeRef(input.issueId),
		title,
	});
};
