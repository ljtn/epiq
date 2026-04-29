import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {
	closeIssue,
	createIssue,
	getEpiqState,
	listBoards,
	listIssues,
	listSwimlanes,
	moveIssue,
} from './tools.js';
import {isFail, Result} from '../lib/command-line/command-types.js';

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
			description: 'List Epiq issues',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				includeClosed: z.boolean().optional(),
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

	return server;
};

export const startMcpServer = async () => {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

await startMcpServer();
