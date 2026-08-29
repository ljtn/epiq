import {z} from 'zod';
import {GuiMessage} from './websocket.model.js';

/**
 * `GuiMessage` is a compile-time type, so `JSON.parse(raw) as GuiMessage` was
 * a promise the wire never had to keep. Two things follow from parsing for
 * real instead:
 *
 * - Handlers spread the payload into an API call (`{repoRoot, ...payload}`),
 *   and the spread wins — so an unknown `repoRoot` key in a frame pointed the
 *   server at another project on the machine. `z.object` drops unknown keys,
 *   which closes that for every handler at once.
 * - A missing or wrong-typed field became a TypeError echoed back to the
 *   client rather than a refusal.
 */
const id = z.string().min(1);

const position = z.discriminatedUnion('at', [
	z.object({at: z.literal('start')}),
	z.object({at: z.literal('end')}),
	z.object({at: z.literal('before'), sibling: id}),
	z.object({at: z.literal('after'), sibling: id}),
]);

// Rejects NaN and ±Infinity, which reached `checkoutStateAt` and the timeline
// bucketing as-is.
const epochMs = z.number().finite();

const message = <T extends string, P extends z.ZodTypeAny>(
	type: T,
	payload: P,
) => z.object({type: z.literal(type), payload});

const bare = <T extends string>(type: T) => z.object({type: z.literal(type)});

export const GuiMessageSchema = z.discriminatedUnion('type', [
	bare('state:get'),
	bare('issues:list'),
	bare('sync'),
	bare('time-travel:live'),

	message(
		'issues:create',
		z.object({
			title: z.string(),
			parentId: id,
			description: z.string().optional(),
			tagNames: z.array(z.string()).optional(),
		}),
	),
	message('swimlane:create', z.object({title: z.string(), boardId: id})),
	message('swimlane:edit:title', z.object({swimlaneId: id, title: z.string()})),
	message('swimlane:delete', z.object({swimlaneId: id})),
	message(
		'swimlane:move',
		z.object({swimlaneId: id, boardId: id, position: position.optional()}),
	),
	message(
		'issues:move',
		z.object({issueId: id, parentId: id, position: position.optional()}),
	),
	message('issue:edit:title', z.object({issueId: id, title: z.string()})),
	message(
		'issue:edit:description',
		z.object({issueId: id, description: z.string()}),
	),
	message('issue:tag:add', z.object({issueId: id, tagName: z.string()})),
	message('issue:tag:remove', z.object({issueId: id, tagId: id})),
	message('contributor:remove', z.object({contributorId: id})),
	message('tag:remove', z.object({tagId: id})),
	z.object({
		type: z.literal('contributors:get'),
		payload: z.object({boardId: id.optional()}).optional(),
	}),
	message(
		'issue:assignee:add',
		z.object({
			issueId: id,
			assigneeId: id.optional(),
			assigneeName: z.string().optional(),
			createUnlinked: z.boolean().optional(),
		}),
	),
	message('issue:assignee:remove', z.object({issueId: id, assigneeId: id})),
	message('issue:close', z.object({issueId: id})),
	message('issue:reopen', z.object({issueId: id})),
	message('issue:comment:add', z.object({issueId: id, body: z.string()})),
	message('issue:comment:delete', z.object({issueId: id, commentId: id})),
	message('issue:get', z.object({issueId: id})),
	z.object({
		type: z.literal('timeline:get'),
		payload: z
			.object({
				start: epochMs.optional(),
				end: epochMs.optional(),
				boardId: id.optional(),
				requestId: z.number().finite().optional(),
			})
			.optional(),
	}),
	z.object({
		type: z.literal('commits:get'),
		payload: z
			.object({
				start: epochMs.optional(),
				end: epochMs.optional(),
				requestId: z.number().finite().optional(),
			})
			.optional(),
	}),
	message('time-travel:scrub', z.object({targetTime: epochMs})),
	message('commit:inspect', z.object({sha: z.string()})),
	message('commit:diff:get', z.object({sha: z.string()})),
	message('issue:commits:get', z.object({issueId: id})),
]);

// Proof the schema still covers the transport it validates: a message the
// schema produces has to be assignable to the type the handlers switch on.
type SchemaMessage = z.infer<typeof GuiMessageSchema>;
const _assertSchemaMatchesModel: SchemaMessage extends GuiMessage
	? true
	: never = true;
void _assertSchemaMatchesModel;

export const parseGuiMessage = (
	raw: unknown,
): {ok: true; message: GuiMessage} | {ok: false; error: string} => {
	const result = GuiMessageSchema.safeParse(raw);

	if (!result.success) {
		const detail = result.error.issues
			.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
			.join(', ');

		return {ok: false, error: `Invalid message: ${detail}`};
	}

	return {ok: true, message: result.data};
};
