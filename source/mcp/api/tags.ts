import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../lib/event/event-materialize-and-persist.js';
import {AppEvent} from '../../lib/event/event.model.js';
import {isTicketNode} from '../../lib/model/context.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {nodeRepo} from '../../lib/repository/node-repo.js';
import {MAX_TAG_NAME_LENGTH, tooLong} from '../../lib/utils/text.limits.js';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {ApiBatchOutcome} from '../api-state.model.js';
import {ToolInput, boot, getActor, getStateResult} from './boot.js';
import {
	IssueTargets,
	IssueRef,
	targetIds,
	batchResult,
	findWritableIssue,
} from './targets.js';

type AddIssueTagInput = ToolInput &
	IssueTargets & {
		tagName: string;
	};

type RemoveIssueTagInput = ToolInput & {
	issueId: string;
	tagId: string;
};

type TagRef = {tag: {id: string; name: string}};

export function addIssueTag(
	input: AddIssueTagInput & {issueIds: string[]},
): Promise<Result<ApiBatchOutcome & TagRef>>;
export function addIssueTag(
	input: AddIssueTagInput,
): Promise<Result<IssueRef & TagRef>>;
export async function addIssueTag(
	input: AddIssueTagInput,
): Promise<Result<(ApiBatchOutcome & TagRef) | (IssueRef & TagRef)>> {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const idsResult = targetIds(input);
	if (isFail(idsResult)) return idsResult;

	const tagName = sanitizeInlineText(input.tagName).trim();
	if (!tagName) return failed('Tag name cannot be empty');

	const overLongTag = tooLong('Tag name', tagName, MAX_TAG_NAME_LENGTH);
	if (overLongTag) return failed(overLongTag);

	// Tagging needs no rank, so every target that checks out goes into one
	// persist, behind the tag's creation if it is new.
	const outcome: ApiBatchOutcome = {done: [], failed: []};

	for (const id of idsResult.value) {
		const issueResult = findWritableIssue(id);
		if (isFail(issueResult)) {
			outcome.failed.push({id, ref: nodeRef(id), reason: issueResult.message});
		} else {
			outcome.done.push({id, ref: nodeRef(id)});
		}
	}

	if (!input.issueIds && outcome.failed[0]) {
		return failed(outcome.failed[0].reason);
	}

	if (outcome.done.length === 0) {
		return failed(batchResult('Tagged', outcome).message);
	}

	const existingTag = nodeRepo.findTagByName(tagName);

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
		...outcome.done.map(
			({id}) =>
				({
					id: ulid(),
					...actorResult.value,
					action: 'add.issue.tag',
					payload: {
						id,
						tag: tagId,
					},
				} satisfies AppEvent<'add.issue.tag'>),
		),
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	const tag = {id: tagId, name: tagName};

	if (!input.issueIds) {
		return succeeded('Added issue tag', {...outcome.done[0]!, tag});
	}

	const batch = batchResult('Tagged', outcome);
	return isFail(batch)
		? batch
		: succeeded(batch.message, {...batch.value, tag});
}

// Tombstone, not deletion: the id and every ticket reference survive in the
// log; the tag just stops rendering anywhere, and its name is free again.
export const tombstoneTag = async (
	input: ToolInput & {tagId: string},
): Promise<Result<{id: string; name: string}>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const tag = stateResult.value.tags[input.tagId];
	if (!tag) return failed('Tag not found');
	if (tag.tombstoned) return failed('Tag is already deleted');

	const events = [
		{
			id: ulid(),
			...actorResult.value,
			action: 'tombstone.tag',
			payload: {id: input.tagId},
		} satisfies AppEvent<'tombstone.tag'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted tag', {id: tag.id, name: tag.name});
};

export const restoreTag = async (
	input: ToolInput & {tagId: string},
): Promise<Result<{id: string; name: string}>> => {
	const bootResult = await boot(input.repoRoot, {pull: false});
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const stateResult = getStateResult();
	if (isFail(stateResult)) return stateResult;

	const tag = stateResult.value.tags[input.tagId];
	if (!tag) return failed('Tag not found');
	if (!tag.tombstoned) return failed('Tag is not deleted');

	// The name may have been taken by a fresh tag in the meantime; two live
	// tags with one name would be indistinguishable everywhere they are picked.
	if (nodeRepo.findTagByName(tag.name)) {
		return failed(`Cannot restore: another tag is already named "${tag.name}"`);
	}

	const events = [
		{
			id: ulid(),
			...actorResult.value,
			action: 'restore.tag',
			payload: {id: input.tagId, name: tag.name},
		} satisfies AppEvent<'restore.tag'>,
	];

	const results = materializeAndPersistAll(
		events,
		bootResult.value.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Restored tag', {id: tag.id, name: tag.name});
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
		ref: nodeRef(input.issueId),
		tagId: input.tagId,
	});
};
