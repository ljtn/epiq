import {ulid} from 'ulid';
import {applyActorNameArgument} from '../../lib/config/actor-env.js';
import {loadEventActors, loadMergedEvents} from '../../lib/event/event-load.js';
import {materializeAndPersistAll} from '../../lib/event/event-materialize-and-persist.js';
import {AppEvent} from '../../lib/event/event.model.js';
import {filterEventsForBoard} from '../timeline-index.js';
import {isTicketNode} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {REMOVED_CONTRIBUTOR_NAME} from '../../lib/model/app-state.model.js';
import {getStringColor} from '../../lib/utils/color.js';
import {
	MAX_ASSIGNEE_NAME_LENGTH,
	tooLong,
} from '../../lib/utils/text.limits.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiAssignee} from '../api-state.model.js';
import {ToolInput, boot, getActor, getStateResult} from './boot.js';
import {getLatestNamesFromLog, mergeRegistryNames} from './issue-helpers.js';

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

/**
 * Takes a board identity for the rest of this process. The actor is resolved
 * per write from the environment, so setting it here reaches the very next
 * event — no relaunch. A name given at launch wins: `applyActorNameArgument`
 * refuses to rename a process that was already told who it is.
 */
export const assumeActor = async (
	input: ToolInput & {name: string},
): Promise<Result<{userId: string; userName: string; registered: boolean}>> => {
	const applied = applyActorNameArgument(input.name, 'name');
	if (isFail(applied)) return failed(applied.message);

	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const actor = actorResult.value;

	// Registered here rather than left to the first write, because the log file
	// name is a lossy storage key — `claude/peter` sanitizes to `claude-peter`
	// — and the registry is where display names are read from.
	const isRegistered = Boolean(stateResult.value.contributors[actor.userId]);

	if (!isRegistered) {
		const results = materializeAndPersistAll(
			[
				{
					id: ulid(),
					...actor,
					action: 'create.contributor',
					payload: {id: actor.userId, name: actor.userName},
				} satisfies AppEvent<'create.contributor'>,
			],
			bootResult.value.stateBranchRoot,
		);

		if (isFail(results)) return failed(results.message);
	}

	return succeeded(`Assumed ${actor.userName}`, {
		...actor,
		registered: !isRegistered,
	});
};

// Reads actors, not decoded events: the actor comes off the file name, so an
// event this build cannot decode still proves its author wrote something. Going
// through the decoded log instead would let an unreadable schema version make
// somebody look unauthored, and the guard below would clear their removal.
const findEventLogAuthor = async (
	stateBranchRoot: string,
	userId: string,
): Promise<{id: string; name: string} | undefined> => {
	const actorsResult = loadEventActors(stateBranchRoot);
	if (isFail(actorsResult)) return undefined;

	let name: string | undefined;

	// Last write wins: a display name changes over time, the id does not.
	for (const actor of actorsResult.value) {
		if (actor.userId === userId) name = actor.userName ?? name;
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
			ref: nodeRef(input.issueId),
			assignee: {id: assignee.id, name: assignee.name},
		});
	}

	const assigneeName = sanitizeInlineText(input.assigneeName ?? '').trim();
	if (!assigneeName) return failed('Provide assigneeId, self or assigneeName');

	const overLongName = tooLong(
		'Assignee name',
		assigneeName,
		MAX_ASSIGNEE_NAME_LENGTH,
	);
	if (overLongName) return failed(overLongName);

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
		ref: nodeRef(input.issueId),
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
	// authored anywhere, so this must read the same actors that guard does —
	// off the file names, including events this build cannot decode.
	const workspaceAuthorIds = new Set<string>();

	const actorsResult = loadEventActors(bootResult.value.stateBranchRoot);
	if (isFail(actorsResult)) return failed(actorsResult.message);

	for (const actor of actorsResult.value) {
		if (actor.userId) workspaceAuthorIds.add(actor.userId);
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
		ref: nodeRef(input.issueId),
		assigneeId: input.assigneeId,
	});
};
