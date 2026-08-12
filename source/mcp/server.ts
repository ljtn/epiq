import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	addIssueAssignee,
	addIssueComment,
	addIssueTag,
	closeIssue,
	createIssue,
	createSwimlane,
	deleteIssueComment,
	deleteSwimlane,
	editIssueDescription,
	editIssueTitle,
	editSwimlaneTitle,
	getEpiqState,
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

export const resultJson = <T>(result: Result<T>) => ({
	isError: isFail(result),
	content: [
		{
			type: 'text' as const,
			text: JSON.stringify(result, null, 2),
		},
	],
});

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
		async input => resultJson(await getEpiqState(input)),
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
		async input => resultJson(await listIssues(input)),
	);

	server.registerTool(
		'epiq_board_list',
		{
			description: 'List Epiq boards',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await listBoards(input)),
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
		async input => resultJson(await listSwimlanes(input)),
	);

	server.registerTool(
		'epiq_swimlane_create',
		{
			description: 'Create an Epiq swimlane on a board',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				boardId: z.string().min(1),
				title: z.string().min(1),
			}),
		},
		async input => resultJson(await createSwimlane(input)),
	);

	server.registerTool(
		'epiq_swimlane_title_edit',
		{
			description: 'Edit an Epiq swimlane title',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
				title: z.string().min(1),
			}),
		},
		async input => resultJson(await editSwimlaneTitle(input)),
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
		async input => resultJson(await moveSwimlane(input)),
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
		async input => resultJson(await deleteSwimlane(input)),
	);

	server.registerTool(
		'epiq_issue_create',
		{
			description: 'Create an Epiq issue',
			inputSchema: z.object({
				title: z.string().min(1),
				parentId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await createIssue(input)),
	);

	server.registerTool(
		'epiq_issue_description_edit',
		{
			description: 'Edit the markdown description of an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				description: z.string(),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await editIssueDescription(input)),
	);

	server.registerTool(
		'epiq_issue_title_edit',
		{
			description: 'Edit the title of an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				title: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await editIssueTitle(input)),
	);

	server.registerTool(
		'epiq_issue_tag_add',
		{
			description:
				'Add a tag to an Epiq issue, creating the tag if it does not exist',
			inputSchema: z.object({
				issueId: z.string().min(1),
				tagName: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await addIssueTag(input)),
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
		async input => resultJson(await removeIssueTag(input)),
	);

	server.registerTool(
		'epiq_issue_assignee_add',
		{
			description:
				'Assign a contributor to an Epiq issue, creating the contributor if they do not exist',
			inputSchema: z.object({
				issueId: z.string().min(1),
				assigneeName: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await addIssueAssignee(input)),
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
		async input => resultJson(await removeIssueAssignee(input)),
	);

	server.registerTool(
		'epiq_issue_comment_add',
		{
			description: 'Add a comment to an Epiq issue',
			inputSchema: z.object({
				issueId: z.string().min(1),
				body: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await addIssueComment(input)),
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
		async input => resultJson(await deleteIssueComment(input)),
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
		async input => resultJson(await reopenIssue(input)),
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
		async input => resultJson(await closeIssue(input)),
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
		async input => resultJson(await moveIssue(input)),
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
		async input => resultJson(await sync(input)),
	);

	return server;
};

export const startMcpServer = async () => {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

await startMcpServer();
