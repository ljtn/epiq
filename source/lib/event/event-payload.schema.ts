import {z} from 'zod';
import {failed, Result, succeeded} from '../model/result-types.js';
import {EventAction} from './event.model.js';

/**
 * What a payload has to look like before a materializer is allowed to touch it.
 *
 * The envelope (`v`, `id`) was the only part ever parsed, so a line that is
 * valid JSON at a supported version naming a known action reached its handler
 * with any shape at all. A peer's log arrives over `merge=union` and the log is
 * append-only, so one such line stopped the board for everybody, permanently:
 * a numeric `rank` threw out of `derive`, a numeric id threw in `nodeRef`, a
 * null `ranks` threw in `Object.entries`, and a node naming itself as its own
 * parent made the move guard's ancestor walk run forever.
 *
 * Two rules shape these schemas:
 *
 * - **Loose, never strict.** Every object accepts unknown keys, because a
 *   newer epiq may add a field to an existing action without bumping
 *   `SCHEMA_VERSION`. Rejecting those would quarantine events this build can
 *   read perfectly well.
 * - **Require only what a handler dereferences.** These are not a description
 *   of the domain; they are the preconditions the code already assumes.
 *   Anything narrower (an enum of extensions, a rank's hex shape) belongs in
 *   the handler as a `materializeSkip`, where a future value is a skipped
 *   event rather than a quarantined one.
 */

const id = z.string().min(1);
const name = z.string();
const rank = z.string();

const withId = z.looseObject({id});

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
	// `val` is unconstrained: the handler puts it straight into the node's
	// props without reading it, so a shape this build did not expect costs
	// nothing, while requiring one would drop the field node entirely.
	'add.field': z.looseObject({id, name, parent: id, rank}),

	'edit.title': z.looseObject({id, name}),
	'delete.node': withId,
	'lock.node': withId,
	'move.node': z.looseObject({id, parent: id, rank}),
	'edit.description': z.looseObject({id, md: z.string()}),

	'close.issue': z.looseObject({id, parent: id, rank}),
	'reopen.issue': z.looseObject({id, parent: id, rank}),

	'create.tag': z.looseObject({id, name}),
	'tombstone.tag': withId,
	'restore.tag': z.looseObject({id, name}),

	'create.epic': z.looseObject({id, name}),

	'create.contributor': z.looseObject({id, name}),
	'rename.contributor': z.looseObject({id, name}),
	'tombstone.contributor': withId,
	'restore.contributor': z.looseObject({id, name}),
	'link.contributor.user': z.looseObject({contributor: id}),

	'add.issue.assignee': z.looseObject({id, assignee: id}),
	'remove.issue.assignee': z.looseObject({id, assignee: id}),
	'add.issue.tag': z.looseObject({id, tag: id}),
	'remove.issue.tag': z.looseObject({id, tag: id}),

	// Clearing names no epic: the handler reads the id and nothing else, so a
	// ticket whose epic is already gone still clears cleanly.
	'set.issue.epic': z.looseObject({id, epic: id}),
	'clear.issue.epic': withId,

	// `author` is unconstrained on both, though the type declares it. The
	// attachment handler never reads it, and the comment handler resolves it
	// through the registry and falls back to "Unknown" — and this board's log
	// already holds an attachment written without one. Requiring it would have
	// made that attachment disappear, which is the exact damage this check
	// exists to prevent.
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
