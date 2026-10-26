import {
	isFail,
	failed,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {REMOVED_CONTRIBUTOR_NAME} from '../../lib/model/app-state.model.js';
import {ulid} from 'ulid';
import {applyActorNameArgument} from '../../lib/config/actor-env.js';
import {
	loadActorNames,
	loadEventActors,
	loadMergedEvents,
} from '../../lib/board/board-log.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {contributorDirectory} from '../../lib/repository/contributor-directory.js';
import {identityOf} from '../../lib/model/identity.js';
import {filterEventsForBoard} from '../timeline-index.js';
import {
	MAX_ASSIGNEE_NAME_LENGTH,
	tooLong,
} from '../../lib/utils/text.limits.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiAssignee} from '../api-state.model.js';
import {ToolInput, bootedWithActorAndState} from './boot.js';
import {boardDescriptionOf} from './descriptions.js';
import {findWritableIssue} from './node-targets.js';
import {isBoardNode} from '../../lib/model/context.model.js';

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
 * Takes a board identity for the rest of this process, from the next event on.
 * A name given at launch wins.
 */
export const assumeActor = async (
	input: ToolInput & {name: string},
): Promise<
	Result<{
		userId: string;
		userName: string;
		registered: boolean;
		boards?: {id: string; title: string; boardDescription: string}[];
	}>
> => {
	const applied = applyActorNameArgument(input.name, 'name');
	if (isFail(applied)) return failed(applied.message);

	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const actor = ready.value.actor;

	// Registered now: the log file name is a lossy key, and names come from the registry.
	const isRegistered = Boolean(ready.value.state.contributors[actor.userId]);

	if (!isRegistered) {
		const results = materializeAndPersistAll(
			[
				{
					id: ulid(),
					...actorOf(actor),
					action: 'create.contributor',
					payload: {id: actor.userId, name: actor.userName},
				} satisfies AppEvent<'create.contributor'>,
			],
			ready.value.boot.stateBranchRoot,
		);

		if (isFail(results)) return failed(results.message);
	}

	// The conventions an agent works under, handed over when it arrives.
	const boards = Object.values(ready.value.state.nodes)
		.filter(n => isBoardNode(n) && !n.isDeleted)
		.flatMap(n => {
			const {boardDescription} = boardDescriptionOf(n.id);
			return boardDescription
				? [{id: n.id, title: sanitizeInlineText(n.title), boardDescription}]
				: [];
		});

	return succeeded(`Assumed ${actor.userName}`, {
		...actor,
		registered: !isRegistered,
		...(boards.length ? {boards} : {}),
	});
};

// Reads actors off file names, so an undecodable event still proves authorship.
const findEventLogAuthor = async (
	stateBranchRoot: string,
	userId: string,
): Promise<{id: string; name: string} | undefined> => {
	// `loadActorNames` has already dropped UNNAMED_ACTOR, so it is never registered.
	const name = loadActorNames(stateBranchRoot).get(userId);

	return name === undefined ? undefined : {id: userId, name};
};

export const addIssueAssignee = async (input: AddIssueAssigneeInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;

	const targetId = input.self ? ready.value.actor.userId : input.assigneeId;

	// An id names a specific person, so an unknown one is an error rather than
	// an invitation to invent a contributor.
	if (targetId) {
		const registered = ready.value.state.contributors[targetId];

		// An author never assigned is absent from the registry; register them under their id.
		const authored = registered
			? undefined
			: await findEventLogAuthor(ready.value.boot.stateBranchRoot, targetId);

		if (!registered && !authored) return failed('Unknown assignee id');

		const assignee = registered ?? authored!;

		const events = [
			...(registered
				? []
				: [
						{
							id: ulid(),
							...actorOf(ready.value.actor),
							action: 'create.contributor',
							payload: {id: assignee.id, name: assignee.name},
						} satisfies AppEvent<'create.contributor'>,
				  ]),
			{
				id: ulid(),
				...actorOf(ready.value.actor),
				action: 'add.issue.assignee',
				payload: {id: input.issueId, assignee: assignee.id},
			} satisfies AppEvent<'add.issue.assignee'>,
		];

		const assignResults = materializeAndPersistAll(
			events,
			ready.value.boot.stateBranchRoot,
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

	// The same union a picker offers; the registry alone misses log-only authors,
	// and an unmatched name mints a duplicate id.
	const matches = contributorDirectory({
		events: ready.value.state.eventLog ?? [],
		registry: ready.value.state.contributors,
		logFileNames: loadActorNames(ready.value.boot.stateBranchRoot),
	}).filter(candidate => candidate.name === assigneeName);

	// Two people can share a display name; picking one silently assigns the
	// wrong person half the time.
	if (matches.length > 1) {
		return failed(
			`"${assigneeName}" matches ${matches.length} contributors (${matches
				.map(({id}) => id)
				.join(', ')}). Assign by assigneeId to choose.`,
		);
	}

	const match = matches[0];

	if (!match && !input.createUnlinked) {
		return failed(
			`No contributor named "${assigneeName}". Assign by id, or pass createUnlinked to add them as an external assignee.`,
		);
	}

	const assigneeId = match?.id ?? ulid();
	const resolvedName = match?.name ?? assigneeName;

	// Keyed on the registry, not on whether a name matched: somebody found only
	// in the event log still needs a contributor record.
	const isRegistered = Boolean(ready.value.state.contributors[assigneeId]);

	const events = [
		...(isRegistered
			? []
			: [
					{
						id: ulid(),
						...actorOf(ready.value.actor),
						action: 'create.contributor',
						payload: {
							id: assigneeId,
							name: resolvedName,
						},
					} satisfies AppEvent<'create.contributor'>,
			  ]),
		{
			id: ulid(),
			...actorOf(ready.value.actor),
			action: 'add.issue.assignee',
			payload: {
				id: input.issueId,
				assignee: assigneeId,
			},
		} satisfies AppEvent<'add.issue.assignee'>,
	];

	const results = materializeAndPersistAll(
		events,
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Added issue assignee', {
		id: input.issueId,
		ref: nodeRef(input.issueId),
		assignee: {id: assigneeId, name: resolvedName},
	});
};

// Tombstone, not deletion; refused for anyone who has authored an event.
export const tombstoneContributor = async (
	input: ToolInput & {contributorId: string},
): Promise<Result<{id: string; name: string}>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const contributor = ready.value.state.contributors[input.contributorId];
	if (!contributor) return failed('Contributor not found');

	const authored = await findEventLogAuthor(
		ready.value.boot.stateBranchRoot,
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
			...actorOf(ready.value.actor),
			action: 'tombstone.contributor',
			payload: {id: input.contributorId},
		} satisfies AppEvent<'tombstone.contributor'>,
	];

	const results = materializeAndPersistAll(
		events,
		ready.value.boot.stateBranchRoot,
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

// Undoes a removal made before somebody's events had been pulled.
export const restoreContributor = async (
	input: ToolInput & {contributorId: string},
): Promise<Result<{id: string; name: string}>> => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const contributor = ready.value.state.contributors[input.contributorId];
	if (!contributor) return failed('Contributor not found');

	if (!contributor.tombstoned) {
		return failed('Contributor is not tombstoned');
	}

	const originalName = await findCreatedContributorName(
		ready.value.boot.stateBranchRoot,
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
			...actorOf(ready.value.actor),
			action: 'restore.contributor',
			payload: {id: input.contributorId, name: originalName},
		} satisfies AppEvent<'restore.contributor'>,
	];

	const results = materializeAndPersistAll(
		events,
		ready.value.boot.stateBranchRoot,
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
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const eventsResult = loadMergedEvents(ready.value.boot.stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const scopedEvents = input.boardId
		? filterEventsForBoard(eventsResult.value, input.boardId)
		: eventsResult.value;

	// Unfiltered, matching the removal guard: actors off file names.
	const workspaceAuthorIds = new Set<string>();

	const actorsResult = loadEventActors(ready.value.boot.stateBranchRoot);
	if (isFail(actorsResult)) return failed(actorsResult.message);

	for (const actor of actorsResult.value) {
		if (actor.userId) workspaceAuthorIds.add(actor.userId);
	}

	const registry = ready.value.state.contributors;

	const contributors = contributorDirectory({
		events: scopedEvents,
		registry,
		logFileNames: loadActorNames(ready.value.boot.stateBranchRoot),
	}).map(({id, name, isExternal}) => ({
		...identityOf(id, name),
		isSelf: id === ready.value.actor.userId,
		// Board-scoped, because the events were: means "has not worked on this
		// board", not "is not in the history".
		isExternal,
		// Read off the record, not compared against the placeholder name, so
		// somebody genuinely called "removed" is not reported as already removed.
		isRemoved: registry[id]?.tombstoned === true,
		// Workspace-wide: their name is in the log, which is what blocks removal.
		hasAuthoredAnywhere: workspaceAuthorIds.has(id),
	}));

	return succeeded('Listed board contributors', contributors);
};

export const removeIssueAssignee = async (input: RemoveIssueAssigneeInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;

	if (!ready.value.state.contributors[input.assigneeId]) {
		return failed('Assignee not found');
	}

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'remove.issue.assignee',
		payload: {
			id: input.issueId,
			assignee: input.assigneeId,
		},
	} satisfies AppEvent<'remove.issue.assignee'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Removed issue assignee', {
		id: input.issueId,
		ref: nodeRef(input.issueId),
		assigneeId: input.assigneeId,
	});
};
