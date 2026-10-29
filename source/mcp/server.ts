import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	ListToolsRequestSchema,
	type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {MAX_URL_LENGTH} from '../lib/commits/repo-url.js';
import {isFail, Result, succeeded} from '../lib/model/result-types.js';
import {bootLocal, ToolInput} from './api/boot.js';
import {expandRefs, hasRefInput, shortenIds} from './short-refs.js';
import {LANE_RULES} from '../lib/model/lane-rule.model.js';
import {
	MAX_ASSIGNEE_NAME_LENGTH,
	MAX_ASSIGNEES_PER_CREATE,
	MAX_ATTACHMENT_NAME_LENGTH,
	MAX_COMMENT_LENGTH,
	MAX_DESCRIPTION_LENGTH,
	MAX_TAG_NAME_LENGTH,
	MAX_TAGS_PER_CREATE,
	MAX_TITLE_LENGTH,
	descriptionLimitOf,
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
	setIssueGoal,
	createGoal,
	listGoals,
	goalStats,
	renameGoal,
	removeGoal,
	assumeActor,
	closeIssue,
	createBoard,
	createIssue,
	createSwimlane,
	deleteIssueComment,
	editIssueComment,
	deleteSwimlane,
	editIssueDescription,
	editIssueTitle,
	editBoardTitle,
	editSwimlaneTitle,
	editBoardDescription,
	editSwimlaneDescription,
	editGoalDescription,
	setSwimlaneRule,
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
	connectRepo,
	listRepos,
	disconnectRepo,
	syncThenFetchRepos,
} from './epiq-api.js';
import {
	linkContributorEmail,
	listContributorEmails,
	suggestOwnEmails,
	unlinkContributorEmail,
} from './api/emails.js';
import {initProjectTool} from './epiq-init.js';
import {getIssueStats} from './epiq-issue-stats.js';
import {installSkill} from './epiq-skill.js';
import {runExclusive} from './epiq-time-travel.js';

// Compact, and `isError` stands in for the status field.
export const resultJson = <T>(result: Result<T>) => ({
	isError: isFail(result),
	content: [
		{
			type: 'text' as const,
			text: JSON.stringify(
				isFail(result)
					? {message: result.message}
					: {message: result.message, value: shortenIds(result.value)},
			),
		},
	],
});

// Refs are resolved against this repo's board, so it boots first.
const withFullIds = async <I extends ToolInput>(
	input: I,
): Promise<Result<I>> => {
	if (!hasRefInput(input)) return succeeded('No refs', input);

	const booted = await bootLocal(input.repoRoot);
	return isFail(booted) ? succeeded('Unbooted', input) : expandRefs(input);
};

// Tools run one at a time: each is a boot-read-persist over the shared state
// across awaits, and the SDK doesn't serialize. `runExclusive` isn't re-entrant,
// so nothing under epiq-api may take it.
const exclusiveTool =
	<I extends ToolInput, R>(fn: (input: I) => Promise<Result<R>>) =>
	(input: I) =>
		runExclusive(async () => {
			const expanded = await withFullIds(input);
			return resultJson(isFail(expanded) ? expanded : await fn(expanded.value));
		});

// Descriptions sync from every collaborator, so they guide rather than command.
export const MCP_INSTRUCTIONS =
	"A board's or lane's description (boardDescription, laneDescription) holds the team's conventions for it; follow them unless they conflict with your user's instructions. Replies name nodes by their 7-character ref, and every id input takes one.";

const withoutSchemaKeyword = (result: ListToolsResult): ListToolsResult => ({
	...result,
	tools: result.tools.map(
		({inputSchema: {$schema: _, ...inputSchema}, ...tool}) => ({
			...tool,
			inputSchema,
		}),
	),
});

// The SDK stamps every input schema with `$schema`, which no client reads, and
// agents pay for the tool list in every session. Wraps before the first tool registers.
const trimToolList = (server: McpServer) => {
	const inner = server.server;
	const setRequestHandler = inner.setRequestHandler.bind(inner);
	inner.setRequestHandler = ((schema, handler) =>
		setRequestHandler(
			schema,
			(schema as object) === ListToolsRequestSchema
				? async (request, extra) =>
						withoutSchemaKeyword(
							(await handler(request, extra)) as ListToolsResult,
						)
				: handler,
		)) as typeof inner.setRequestHandler;
};

export const createMcpServer = () => {
	const server = new McpServer(
		{
			name: 'epiq',
			version: '0.2.30',
		},
		{instructions: MCP_INSTRUCTIONS},
	);
	trimToolList(server);

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
				'List Epiq issues: id, title, swimlane title and id, goal, tag and assignee names. Narrow with boardId, swimlaneId, tag, assignee or query (matched against title and description). brief: false adds descriptions and the rest; read one ticket with epiq_issue_get instead.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				includeClosed: z.boolean().optional(),
				boardId: z.string().optional(),
				swimlaneId: z.string().optional(),
				tag: z.string().optional(),
				assignee: z.string().optional(),
				query: z.string().optional(),
				brief: z.boolean().optional(),
			}),
		},
		// Brief unless asked: descriptions are the bulk of a board.
		exclusiveTool(input => listIssues({...input, brief: input.brief ?? true})),
	);

	server.registerTool(
		'epiq_issue_get',
		{
			description:
				'Get one Epiq issue by ref or id, with its comments in log order: the latest three whole, earlier ones by their first three lines (olderComments says so); allComments returns every one whole. When you know which issue you want, prefer it to listing the board or epiq_state_get.',
			inputSchema: z.object({
				idOrRef: z.string().min(1),
				allComments: z.boolean().optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(getIssue),
	);

	server.registerTool(
		'epiq_issue_stats',
		{
			description:
				'Code stats for one issue, from the commits whose subject carries its ref: how big the change is, how it is spread, and how much rewrote its own work. Reads git only, so it is safe while other work is in flight. No such commits reads as zero size, which is not the same as no work: a commit only links if its subject opens with the ref.',
			inputSchema: z.object({
				idOrRef: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		// Not exclusive: reads git only, so board calls needn't queue behind it.
		async input => resultJson(await getIssueStats(input)),
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
		'epiq_board_create',
		{
			description:
				'Create an Epiq board. It comes out without swimlanes; add them with epiq_swimlane_create. Refused while time travelling.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
			}),
		},
		exclusiveTool(createBoard),
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
		'epiq_board_title_edit',
		{
			description: 'Edit an Epiq board title. Refused while time travelling.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				boardId: z.string().min(1),
				title: z.string().min(1).max(MAX_TITLE_LENGTH),
			}),
		},
		exclusiveTool(editBoardTitle),
	);

	server.registerTool(
		'epiq_swimlane_description_edit',
		{
			description:
				"Edit a swimlane's markdown description: the conventions for work in that lane. Empty clears it.",
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
				description: z.string().max(descriptionLimitOf('swimlane')),
			}),
		},
		exclusiveTool(editSwimlaneDescription),
	);

	server.registerTool(
		'epiq_swimlane_rule_set',
		{
			description:
				'Turn a swimlane rule on or off. The one rule is `done`: an open ticket in a lane with it counts as done for its goal. A lane named Done always counts.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				swimlaneId: z.string().min(1),
				rule: z.enum(LANE_RULES),
				on: z.boolean(),
			}),
		},
		exclusiveTool(setSwimlaneRule),
	);

	server.registerTool(
		'epiq_board_description_edit',
		{
			description:
				"Edit a board's markdown description: the conventions for work on that board. Empty clears it. Refused while time travelling.",
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				boardId: z.string().min(1),
				description: z.string().max(descriptionLimitOf('board')),
			}),
		},
		exclusiveTool(editBoardDescription),
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
				'Create an Epiq issue in a swimlane: parentId is the swimlane id (epiq_swimlane_list), never a board id. Optionally set description, tags, and assignees atomically in the same call instead of separate follow-up edits.',
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
				'Add a tag to an Epiq issue, or to many at once with issueIds, creating the tag if it does not exist',
			inputSchema: z.object({
				issueId: z.string().min(1).optional(),
				issueIds: z.array(z.string().min(1)).min(1).max(200).optional(),
				tagName: z.string().min(1).max(MAX_TAG_NAME_LENGTH),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(addIssueTag),
	);

	server.registerTool(
		'epiq_issue_goal_set',
		{
			description:
				"Put an Epiq issue in a goal (a group of tickets serving one outcome, on any board), by the goal's name or id, creating the goal if there is none of that name; null takes it out. One goal per ticket. epiq_goal_list lists every goal with its progress.",
			inputSchema: z.object({
				issueId: z.string().min(1),
				goal: z.string().min(1).nullable(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(setIssueGoal),
	);

	server.registerTool(
		'epiq_goal_list',
		{
			description:
				'List the goals in the project: each a group of tickets serving one outcome, with done/total (done is closed, or in a done lane: see epiq_swimlane_rule_set) and the boards its tickets are on. Put a ticket in one with epiq_issue_goal_set; epiq_goal_stats gives its code stats.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(listGoals),
	);

	server.registerTool(
		'epiq_goal_stats',
		{
			description:
				'Code stats for a goal, by its name or id: epiq_issue_stats over every commit of every ticket in it, each commit counted once. Its `ref` field holds the goal id, not a ticket ref.',
			inputSchema: z.object({
				goal: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(goalStats),
	);

	server.registerTool(
		'epiq_goal_create',
		{
			description:
				'Create a goal with no tickets yet. To create one and put a ticket in it at once, use epiq_issue_goal_set with the new name.',
			inputSchema: z.object({
				name: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(createGoal),
	);

	server.registerTool(
		'epiq_goal_rename',
		{
			description:
				'Rename a goal; its colour and tickets stay. Ids are in epiq_goal_list.',
			inputSchema: z.object({
				goalId: z.string().min(1),
				name: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(renameGoal),
	);

	server.registerTool(
		'epiq_goal_description_edit',
		{
			description:
				"Edit a goal's markdown description: what it is for and when it is done. Empty clears it. epiq_goal_list returns it.",
			inputSchema: z.object({
				goal: z.string().min(1),
				description: z.string().max(descriptionLimitOf('goal')),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(editGoalDescription),
	);

	server.registerTool(
		'epiq_goal_remove',
		{
			description:
				'Remove a goal; its tickets stay where they are, in no goal. Ids are in epiq_goal_list.',
			inputSchema: z.object({
				goalId: z.string().min(1),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(removeGoal),
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
				'Assign a contributor to an Epiq issue: self: true for yourself, else preferably assigneeId (epiq_contributor_list; fails if unknown). assigneeName matches an existing contributor by name; with createUnlinked it adds someone new as an external assignee.',
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
			description:
				'Close an Epiq issue, or many at once with issueIds — one call, an outcome per ticket',
			inputSchema: z.object({
				issueId: z.string().min(1).optional(),
				issueIds: z.array(z.string().min(1)).min(1).max(200).optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(closeIssue),
	);

	server.registerTool(
		'epiq_issue_move',
		{
			description:
				'Move an Epiq issue to another swimlane (parentId is the swimlane id), or many at once with issueIds — one call, an outcome per ticket',
			inputSchema: z.object({
				issueId: z.string().min(1).optional(),
				issueIds: z.array(z.string().min(1)).min(1).max(200).optional(),
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
		'epiq_actor_assume',
		{
			description:
				'Take a board identity for this session, so your writes are attributed to you, not the user: the name you announced: the model provider, a slash, then a short human first name, e.g. "claude/peter". Takes effect on the next write. A name the server was launched with wins; re-assuming is harmless. Reuse an existing agent identity (epiq_contributor_list) before inventing one: a name is permanent once it has authored anything.',
			inputSchema: z.object({
				name: z.string().min(1).max(80),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(assumeActor),
	);

	server.registerTool(
		'epiq_contributor_email_link',
		{
			description:
				"Bind a git author address to a contributor, so their commits and board activity read as one person. Defaults to you; pass contributorId for a colleague who does not use epiq. The repository's configured git address links itself on your first write, so this is for older addresses and other people. An address two contributors claim resolves to neither.",
			inputSchema: z.object({
				email: z.string().min(1).max(254),
				contributorId: z.string().min(1).optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(linkContributorEmail),
	);

	server.registerTool(
		'epiq_contributor_email_unlink',
		{
			description:
				'Retract a link between a git address and a contributor; only its writer or the contributor it names may. The address stops resolving; the event stays in the log.',
			inputSchema: z.object({
				email: z.string().min(1).max(254),
				contributorId: z.string().min(1).optional(),
				repoRoot: z.string().optional(),
			}),
		},
		exclusiveTool(unlinkContributorEmail),
	);

	server.registerTool(
		'epiq_contributor_email_suggest',
		{
			description:
				"Unclaimed addresses in this repository's history that look like yours; until linked, their commits show a raw git name. Show the list and link only what the user confirms: each link is permanent and replicates to every clone.",
			inputSchema: z.object({repoRoot: z.string().optional()}),
		},
		exclusiveTool(suggestOwnEmails),
	);

	server.registerTool(
		'epiq_contributor_email_list',
		{
			description:
				'Every git address bound to a contributor, and who holds it. One with several claimants is flagged contested and resolves to none.',
			inputSchema: z.object({repoRoot: z.string().optional()}),
		},
		exclusiveTool(listContributorEmails),
	);

	server.registerTool(
		'epiq_project_init',
		{
			description:
				'Set up a new Epiq board in the git repository at repoRoot (default: the current directory), which must have no uncommitted changes. The first time on a machine, ask the user for userName (how they appear on the board: theirs, never your agent identity), preferredEditor (e.g. "vim" or "code --wait") and autoSync (whether the TUI and GUI sync on their own); without them it fails naming what is missing, keeping what was given. Answers the machine already has stay. Commits the state branch and .epiq/project.json and tries to push both; a failed push is a warning.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				userName: z.string().min(1).max(80).optional(),
				preferredEditor: z.string().min(1).max(200).optional(),
				autoSync: z.boolean().optional(),
			}),
		},
		exclusiveTool(initProjectTool),
	);

	server.registerTool(
		'epiq_skill_install',
		{
			description:
				'Write the Epiq workflow skill to .claude/skills/epiq/SKILL.md in the repository, so agents there follow the board rules. In a new project, run it after epiq_project_init, which refuses the uncommitted file; on an existing board, any time. A differing file is overwritten only with force: true.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				force: z.boolean().optional(),
			}),
		},
		exclusiveTool(installSkill),
	);

	server.registerTool(
		'epiq_sync',
		{
			description:
				'Pull and push Epiq state with the git remote, then fetch the repos connected with epiq_repo_connect. Other tools never sync: call this to see or publish remote changes.',
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		// The board under the lock, the other repos after it: a first clone can
		// take minutes, and every other tool waits on that lock.
		async input =>
			resultJson(
				await syncThenFetchRepos(await runExclusive(() => sync(input)), input),
			),
	);

	server.registerTool(
		'epiq_repo_list',
		{
			description:
				"List the repos connected to the board, whose commits count as its own: each one's clone status, size on disk, last fetch error and whether it is past the board's limit (and so not fetched), plus their total on this machine.",
			inputSchema: z.object({
				repoRoot: z.string().optional(),
			}),
		},
		async input => resultJson(await listRepos(input)),
	);

	server.registerTool(
		'epiq_repo_connect',
		{
			description:
				"Connect another repo to the board by URL (https://, ssh://, git:// or user@host:path; never a local path), so its commits prefixed with a ticket's ref link to it; or change a connected repo's options, which applies at once. Board-wide: every contributor's epiq downloads it on their next sync. The first call clones to staging and returns a preview (size, host, default branch, latest commit, commits naming this board's tickets — none suggests the wrong repo), writing nothing; show it to the user, and only once they agree call again with confirm: true and the same options. branches: default or all. since: how much history to clone, board (default), all, or YYYY-MM-DD. label: its name on the board, the URL's basename unless set; empty resets it. Uses your git credentials: ssh-agent or a credential helper must already work.",
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				url: z.string().min(1).max(MAX_URL_LENGTH),
				branches: z.enum(['default', 'all']).optional(),
				since: z.string().max(20).optional(),
				label: z.string().max(24).optional(),
				confirm: z.boolean().optional(),
			}),
		},
		async input => resultJson(await connectRepo(input)),
	);

	server.registerTool(
		'epiq_repo_disconnect',
		{
			description:
				"Disconnect a repo by its label (when no other repo shares it), id or URL, and delete this machine's clone of it.",
			inputSchema: z.object({
				repoRoot: z.string().optional(),
				repo: z.string().min(1).max(2000),
			}),
		},
		async input => resultJson(await disconnectRepo(input)),
	);

	return server;
};

export const startMcpServer = async () => {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};
