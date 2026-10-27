import {z} from 'zod';
import {failed, Result, succeeded} from '../model/result-types.js';
import {EventAction} from './board-events.model.js';

/**
 * What a payload must look like before a materializer touches it. Loose, requiring only
 * what a handler dereferences: narrower checks go in the handler as `materializeSkip`,
 * or a newer build's value quarantines the event.
 */

const id = z.string().min(1);
const name = z.string();
const rank = z.string();

const withId = z.looseObject({id});
// A lane rule's name; a newer build's is kept, so it is bounded, not listed.
const rule = z.string().min(1).max(64);

const positioned = z.looseObject({
	id,
	name,
	parent: id,
	rank,
});

const EventPayloadSchemas: Record<EventAction, z.ZodType> = {
	'init.workspace': z.looseObject({id, name, rank}),
	'add.workspace': z.looseObject({id, name, rank}),
	'add.board': positioned,
	'add.swimlane': positioned,
	'add.issue': positioned,
	// `val` is unconstrained: the handler never reads it.
	'add.field': z.looseObject({id, name, parent: id, rank}),

	'edit.title': z.looseObject({id, name}),
	'delete.node': withId,
	'lock.node': withId,
	'move.node': z.looseObject({id, parent: id, rank}),
	'edit.description': z.looseObject({id, md: z.string()}),
	'add.swimlane.rule': z.looseObject({id, rule}),
	'remove.swimlane.rule': z.looseObject({id, rule}),

	'close.issue': z.looseObject({id, parent: id, rank}),
	'reopen.issue': z.looseObject({id, parent: id, rank}),

	'create.tag': z.looseObject({id, name}),
	'tombstone.tag': withId,
	'restore.tag': z.looseObject({id, name}),
	'create.goal': z.looseObject({id, name}),
	'rename.goal': z.looseObject({id, name}),
	'edit.goal.description': z.looseObject({id, md: z.string()}),
	'tombstone.goal': withId,

	'create.contributor': z.looseObject({id, name}),
	'rename.contributor': z.looseObject({id, name}),
	'tombstone.contributor': withId,
	'restore.contributor': z.looseObject({id, name}),
	'link.contributor.user': z.looseObject({contributor: id}),

	// `email` is only shape-checked; the handler normalizes it.
	'link.contributor.email': z.looseObject({contributor: id, email: id}),
	'unlink.contributor.email': z.looseObject({contributor: id, email: id}),

	// Every field is checked by the reducer, one at a time: a value this build
	// cannot read drops that field, not the event.
	'connect.repo': z.looseObject({url: z.string()}),
	'edit.repo': z.looseObject({repo: id}),
	'disconnect.repo': z.looseObject({repo: id}),

	'add.issue.assignee': z.looseObject({id, assignee: id}),
	'remove.issue.assignee': z.looseObject({id, assignee: id}),
	'add.issue.tag': z.looseObject({id, tag: id}),
	'remove.issue.tag': z.looseObject({id, tag: id}),
	'add.issue.goal': z.looseObject({id, goal: id}),
	'remove.issue.goal': z.looseObject({id, goal: id}),

	// `author` is unconstrained, though typed: logs exist with attachments lacking one.
	'add.issue.comment': z.looseObject({id, issue: id, md: z.string()}),
	'edit.issue.comment': z.looseObject({id, issue: id, md: z.string()}),
	'delete.issue.comment': z.looseObject({id, issue: id}),

	'add.issue.attachment': z.looseObject({
		id,
		issue: id,
		hash: z.string().min(1),
		ext: z.string().min(1),
		name,
		bytes: z.number(),
	}),
	'delete.issue.attachment': z.looseObject({id, issue: id}),

	// Values are ranks, keys node ids. `Object.entries` over anything else
	// throws, and a rank that is not a string reaches the child index sort.
	'rebalance.children': z.looseObject({
		parent: id,
		ranks: z.record(z.string(), rank),
	}),
};

export const parseEventPayload = (
	action: EventAction,
	payload: unknown,
): Result<void> => {
	const schema = EventPayloadSchemas[action];

	const result = schema.safeParse(payload);
	if (result.success) return succeeded('Payload is readable', undefined);

	return failed(
		`${action}: ${result.error.issues
			.map(issue => `${issue.path.join('.') || 'payload'} ${issue.message}`)
			.join(', ')}`,
	);
};
