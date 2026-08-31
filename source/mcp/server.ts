import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	MAX_ASSIGNEE_NAME_LENGTH,
	MAX_ASSIGNEES_PER_CREATE,
	MAX_ATTACHMENT_NAME_LENGTH,
	MAX_COMMENT_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_TAG_NAME_LENGTH,
	MAX_TAGS_PER_CREATE,
	MAX_TITLE_LENGTH,
} from '../lib/utils/text.limits.js';
import {
	addIssueAssignee,
	addIssueAttachment,
	getBoardContributors,
	tombstoneContributor,
	restoreContributor,
	tombstoneTag,
	restoreTag,
	addIssueComment,
	addIssueTag,
	closeIssue,
	createIssue,
	createSwimlane,
	deleteIssueComment,
	editIssueComment,
	deleteSwimlane,
	editIssueDescription,
	editIssueTitle,
	editSwimlaneTitle,
	getEpiqState,
	getIssue,
	listBoards,
	listIssues,
	listSwimlanes,
	moveIssue,
	moveSwimlane,
	removeIssueAssignee,
	removeIssueTag,
	reopenIssue,
	sync,
} from './epiq-api.js';
import {runExclusive} from './epiq-time-travel.js';

export const resultJson = <T>(result: Result<T>) => ({
	isError: isFail(result),
	content: [
		{
			type: 'text' as const,
			text: JSON.stringify(result, null, 2),
		},
	],
});

// The MCP SDK does not serialize requests, and every epiq-api call is a
// boot-read-persist over the shared state singleton across several awaits —
// two in flight interleave, so one call's boot() can rebuild the state another
// call already checked its preconditions against. Serialized here, at the
// registration boundary, like the GUI's `runMutation` and websocket handlers.
// `runExclusive` is not re-entrant; nothing reached from epiq-api takes it.
const exclusiveTool =
	<I, R>(fn: (input: I) => Promise<Result<R>>) =>
	(input: I) =>
		runExclusive(async () => resultJson(await fn(input)));

export const createMcpServer = () => {
	const server = new McpServer({
		name: 'epiq',
		version: '0.2.30',
	});

	server.registerTool(
		'epiq_state_get',
		{
			description:
				'Get the full current Epiq state, including nodes and event log',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(getEpiqState),
	);

	server.registerTool(
		'epiq_issue_list',
		{
			description:
				'List Epiq issues. Pass boardId to scope results to a single board and reduce response size.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				includeClosed: z.boolean().optional(),
				boardId: z.string().optional(),
			}),
		},
		exclusiveTool(listIssues),
	);

	server.registerTool(
		'epiq_issue_get',
		{
			description:
				'Get one Epiq issue by its full id or its 7-character ref. Use this rather than listing the whole board when you already know which issue you want.',
			inputSchema: z.object({
				idOrRef: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(getIssue),
	);

	server.registerTool(
		'epiq_board_list',
		{
			description: 'List Epiq boards',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(listBoards),
	);

	server.registerTool(
		'epiq_swimlane_list',
		{
			description: 'List Epiq swimlanes',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				boardId: z.string().optional(),
			}),
		},
		exclusiveTool(listSwimlanes),
	);

	server.registerTool(
		'epiq_swimlane_create',
		{
			description: 'Create an Epiq swimlane on a board',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				boardId: z.string().min(1),
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
			}),
		},
		exclusiveTool(createSwimlane),
	);

	server.registerTool(
		'epiq_swimlane_title_edit',
		{
			description: 'Edit an Epiq swimlane title',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
			}),
		},
		exclusiveTool(editSwimlaneTitle),
	);

	server.registerTool(
		'epiq_swimlane_move',
		{
			description: 'Move/reorder an Epiq swimlane, optionally to another board',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
				boardId: z.string().min(1),
				position: z
					.discriminatedUnion('at', [
						z.object({at: z.literal('start')}),
						z.object({at: z.literal('end')}),
						z.object({
							at: z.literal('before'),
							sibling: z.string().min(1),
						}),
						z.object({
							at: z.literal('after'),
							sibling: z.string().min(1),
						}),
					])
					.optional(),
			}),
		},
		exclusiveTool(moveSwimlane),
	);

	server.registerTool(
		'epiq_swimlane_delete',
		{
			description:
				'Delete (archive) an Epiq swimlane. This also archives every issue contained in it.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
			}),
		},
		exclusiveTool(deleteSwimlane),
	);

	server.registerTool(
		'epiq_issue_create',
		{
			description:
				'Create an Epiq issue. Optionally set description, tags, and assignees atomically in the same call instead of separate follow-up edits.',
			inputSchema: z.object({
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
				parentId: z.string().min(1),
				repoRoot: z.string().optional(),
				description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
				tagNames: z
					.array(z.string().max(MAX_TAG_NAME_LENGTH))
					.max(MAX_TAGS_PER_CREATE)
					.optional(),
				assigneeNames: z
					.array(z.string().max(MAX_ASSIGNEE_NAME_LENGTH))
					.max(MAX_ASSIGNEES_PER_CREATE)
					.optional(),
			}),
		},
		exclusiveTool(createIssue),
	);

	server.registerTool(
		'epiq_issue_description_edit',
		{
			description: 'Edit the markdown description of an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				description: z.string().max(MAX_DESCRIPTION_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(editIssueDescription),
	);

	server.registerTool(
		'epiq_issue_title_edit',
		{
			description: 'Edit the title of an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(editIssueTitle),
	);

	server.registerTool(
		'epiq_issue_tag_add',
		{
			description:
				'Add a tag to an Epiq issue, creating the tag if it does not exist',
			inputSchema: z.object({
				issueId: z.string().min(1),
				tagName: z.string().min(1).max(MAX_TAG_NAME_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(addIssueTag),
	);

	server.registerTool(
		'epiq_issue_tag_remove',
		{
			description: 'Remove a tag from an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				tagId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(removeIssueTag),
	);

	server.registerTool(
		'epiq_contributor_list',
		{
			description:
				'List people who can be assigned: everyone who has authored an event (optionally scoped to one board) unioned with the contributor registry. Use these ids with epiq_issue_assignee_add rather than assigning by name.',
			inputSchema: z.object({
				boardId: z.string().min(1).optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(getBoardContributors),
	);

	server.registerTool(
		'epiq_contributor_remove',
		{
			description:
				'Remove an external contributor from the assignee suggestion lists. Their id and every reference to it survive, so existing assignments stay intact and the event log is untouched. Refused for anyone who has authored events, since their name is in the log regardless.',
			inputSchema: z.object({
				contributorId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(tombstoneContributor),
	);

	server.registerTool(
		'epiq_tag_remove',
		{
			description:
				'Delete a tag from the whole workspace. It disappears from every ticket, picker and filter, but its id and history stay in the event log, and the name is free for a new tag.',
			inputSchema: z.object({
				tagId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(tombstoneTag),
	);

	server.registerTool(
		'epiq_tag_restore',
		{
			description:
				'Put back a tag deleted with epiq_tag_remove, on every ticket that still carried it.',
			inputSchema: z.object({
				tagId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(restoreTag),
	);

	server.registerTool(
		'epiq_contributor_restore',
		{
			description:
				'Put a contributor removed with epiq_contributor_remove back into the suggestion lists, under the name they were created with.',
			inputSchema: z.object({
				contributorId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(restoreContributor),
	);

	server.registerTool(
		'epiq_issue_assignee_add',
		{
			description:
				'Assign a contributor to an Epiq issue. Pass self:true to assign yourself. Prefer assigneeId otherwise, which assigns a known contributor (from the registry or the event log) and fails if the id is unknown. assigneeName matches an existing contributor by name; to create somebody new from a name you must also pass createUnlinked, which adds them as an external (non-contributor) assignee.',
			inputSchema: z.object({
				issueId: z.string().min(1),
				assigneeId: z.string().min(1).optional(),
				self: z.boolean().optional(),
				assigneeName: z
					.string()
					.min(1)
					.max(MAX_ASSIGNEE_NAME_LENGTH)
					.optional(),
				createUnlinked: z.boolean().optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(addIssueAssignee),
	);

	server.registerTool(
		'epiq_issue_assignee_remove',
		{
			description: 'Remove an assignee from an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				assigneeId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(removeIssueAssignee),
	);

	server.registerTool(
		'epiq_issue_comment_add',
		{
			description: 'Add a comment to an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				body: z.string().min(1).max(MAX_COMMENT_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(addIssueComment),
	);

	server.registerTool(
		'epiq_issue_attachment_add',
		{
			description:
				'Attach an image file to an Epiq issue. Returns `markdown` — paste it into a comment or description body to render the image inline.',
			inputSchema: z.object({
				issueId: z.string().min(1),
				filePath: z.string().min(1),
				name: z.string().min(1).max(MAX_ATTACHMENT_NAME_LENGTH).optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(addIssueAttachment),
	);

	server.registerTool(
		'epiq_issue_comment_delete',
		{
			description: 'Delete a comment from an Epiq issue',
			inputSchema: z.object({
				commentId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(deleteIssueComment),
	);

	server.registerTool(
		'epiq_issue_comment_edit',
		{
			description:
				'Replace the body of one of your own comments on an Epiq issue',
			inputSchema: z.object({
				commentId: z.string().min(1),
				body: z.string().min(1).max(MAX_COMMENT_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(editIssueComment),
	);

	server.registerTool(
		'epiq_issue_reopen',
		{
			description:
				'Reopen a closed Epiq issue, restoring it to its previous swimlane',
			inputSchema: z.object({
				issueId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(reopenIssue),
	);

	server.registerTool(
		'epiq_issue_close',
		{
			description: 'Close an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(closeIssue),
	);

	server.registerTool(
		'epiq_issue_move',
		{
			description: 'Move an Epiq issue to another swimlane',
			inputSchema: z.object({
				issueId: z.string().min(1),
				parentId: z.string().min(1),
				position: z
					.discriminatedUnion('at', [
						z.object({at: z.literal('start')}),
						z.object({at: z.literal('end')}),
						z.object({
							at: z.literal('before'),
							sibling: z.string().min(1),
						}),
						z.object({
							at: z.literal('after'),
							sibling: z.string().min(1),
						}),
					])
					.optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(moveIssue),
	);

	server.registerTool(
		'epiq_sync',
		{
			description:
				'Sync Epiq state with the configured Git remote (pull remote changes and push local ones). Other Epiq MCP tools only read and write local state and never sync automatically — call this on demand when you need to see or publish the latest remote changes.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(sync),
	);

	return server;
};

export const startMcpServer = async () => {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};
