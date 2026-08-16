import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {REMOVED_CONTRIBUTOR_NAME} from '../../lib/model/app-state.model.js';
import {MAX_COMMENT_LENGTH} from '../../lib/utils/comment.limits.js';
import {NavNode} from '../../lib/model/navigation-node.model.js';
import {AnyContext} from '../../lib/model/context.model.js';

vi.mock('../../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(() =>
		succeeded('Resolved state branch root', '/state'),
	),
}));

vi.mock('../../git/git.js', () => ({
	ensureStateBranchWorktree: vi.fn(() =>
		succeeded('Ensured state branch worktree', undefined),
	),
}));

vi.mock('../../git/git-utils.js', () => ({
	execGit: vi.fn(() => succeeded('Pulled', '')),
}));

vi.mock('../../lib/project-setup/project-setup.js', () => ({
	getProjectFileContents: vi.fn(() => ({
		stateBranch: 'epiq-state',
	})),
}));

vi.mock('../../git/sync-and-reload-state.js', () => ({
	syncAndReloadState: vi.fn(() => succeeded('Synced', true)),
}));

vi.mock('../../git/sync.js', () => ({
	resetHardToRemoteState: vi.fn(() =>
		succeeded('Synced from remote', {
			repoRoot: '/repo',
			stateBranchRoot: '/state',
		}),
	),
	syncEpiqWithRemote: vi.fn(() =>
		succeeded('Synced', {
			repoRoot: '/repo',
			stateBranchRoot: '/state',
			createdCommit: false,
			pulled: false,
			pushed: false,
			bootstrapped: false,
		}),
	),
}));

vi.mock('../../lib/storage/paths.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../../lib/storage/paths.js')
	>();

	return {
		...actual,
		resolveClosestEpiqProjectRoot: vi.fn((dir: string) =>
			succeeded('Resolved closest epiq project root', dir),
		),
	};
});

vi.mock('../../lib/event/event-load.js', () => ({
	loadMergedEvents: vi.fn(() => succeeded('loaded', [])),
}));

const eventLoadModule = await import('../../lib/event/event-load.js');

vi.mock('../../lib/event/event-boot.js', () => ({
	bootStateFromEventLog: vi.fn(() => succeeded('booted', null)),
}));

vi.mock('../../lib/event/log-utils.js', () => ({
	resolveReopenParentFromLog: vi.fn(() => 'swimlane-1'),
}));

vi.mock('../../lib/config/user-config.js', () => ({
	loadSettingsFromConfig: vi.fn(
		() =>
			({
				status: 'success',
				message: 'loaded settings',
				value: {
					userId: 'user-1',
					userName: 'Alice',
				},
			} satisfies Result),
	),
}));

vi.mock('../../lib/event/event-materialize-and-persist.js', () => ({
	materializeAndPersistAll: vi.fn(() => [succeeded('persisted', null)]),
}));

vi.mock('../../lib/repository/rank.js', () => ({
	resolveAndPersistRankForCreate: vi.fn((parentId: string) => {
		if (parentId === 'missing') {
			return failed('Unable to locate parent swimlane: missing');
		}

		return succeeded('Resolved rank', 'm0');
	}),
	resolveAndPersistRankForMove: vi.fn((parentId: string) => {
		if (parentId === 'readonly-swimlane') {
			return failed('Cannot move issue to readonly swimlane');
		}

		return succeeded('Resolved rank', 'm0');
	}),
}));

const nodes: Record<string, Partial<NavNode<AnyContext>>> = {
	'board-1': {
		id: 'board-1',
		title: 'Default',
		context: 'BOARD',
		parentNodeId: 'workspace-1',
		readonly: false,
		isDeleted: false,
		rank: 'a0',
	},
	'swimlane-1': {
		id: 'swimlane-1',
		title: 'Todo',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: false,
		isDeleted: false,
		rank: 'a0',
	},
	'swimlane-2': {
		id: 'swimlane-2',
		title: 'Review',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: false,
		isDeleted: false,
		rank: 'b0',
	},
	'readonly-swimlane': {
		id: 'readonly-swimlane',
		title: 'Locked',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: true,
		isDeleted: false,
		rank: 'c0',
	},
	'issue-1': {
		id: 'issue-1',
		title: 'Fix bug',
		context: 'TICKET',
		parentNodeId: 'swimlane-1',
		readonly: false,
		isDeleted: false,
		rank: 'a0',
		props: {
			description: 'A bug description',
			tags: ['tag-1'],
			assignees: ['contributor-1'],
		},
	},
	'issue-closed-1': {
		id: 'issue-closed-1',
		title: 'Old bug',
		context: 'TICKET',
		parentNodeId: '00KM6CZ900T7180RM46K0JAYNF',
		readonly: false,
		isDeleted: false,
		rank: 'z0',
		props: {description: '', tags: [], assignees: []},
	},
	'board-2': {
		id: 'board-2',
		title: 'Other board',
		context: 'BOARD',
		parentNodeId: 'workspace-1',
		readonly: false,
		isDeleted: false,
		rank: 'b0',
	},
	'swimlane-3': {
		id: 'swimlane-3',
		title: 'Todo',
		context: 'SWIMLANE',
		parentNodeId: 'board-2',
		readonly: false,
		isDeleted: false,
		rank: 'a0',
	},
	'issue-2': {
		id: 'issue-2',
		title: 'Other board issue',
		context: 'TICKET',
		parentNodeId: 'swimlane-3',
		readonly: false,
		isDeleted: false,
		rank: 'a0',
		props: {description: '', tags: [], assignees: []},
	},
	'deleted-board': {
		id: 'deleted-board',
		title: 'Deleted board',
		context: 'BOARD',
		parentNodeId: 'workspace-1',
		readonly: false,
		isDeleted: true,
		rank: 'c0',
	},
	'deleted-swimlane': {
		id: 'deleted-swimlane',
		title: 'Deleted swimlane',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: false,
		isDeleted: true,
		rank: 'd0',
	},
	'deleted-issue': {
		id: 'deleted-issue',
		title: 'Deleted issue',
		context: 'TICKET',
		parentNodeId: 'swimlane-1',
		readonly: false,
		isDeleted: true,
		rank: 'e0',
		props: {description: '', tags: [], assignees: []},
	},
};

// Mutable; reset in beforeEach.
const contributorRegistry: Record<
	string,
	{id: string; name: string; tombstoned?: boolean}
> = {
	'contributor-1': {id: 'contributor-1', name: 'Alice'},
};

const DEFAULT_CONTRIBUTOR_REGISTRY = {
	'contributor-1': {id: 'contributor-1', name: 'Alice'},
};

// The *state* event log, distinct from the merged on-disk log loadMergedEvents
// supplies. Name resolution reads this one.
const DEFAULT_STATE_EVENT_LOG = [
	{
		id: 'comment-event-1',
		userId: 'user-1',
		userName: 'Alice',
		action: 'add.issue.comment',
		payload: {
			id: 'comment-1',
			issue: 'issue-1',
			md: 'A comment',
			author: 'user-1',
		},
	},
];

let stateEventLog: unknown[] = [...DEFAULT_STATE_EVENT_LOG];

const resetContributorFixtures = () => {
	for (const key of Object.keys(contributorRegistry))
		delete contributorRegistry[key];
	Object.assign(
		contributorRegistry,
		structuredClone(DEFAULT_CONTRIBUTOR_REGISTRY),
	);
	stateEventLog = [...DEFAULT_STATE_EVENT_LOG];
};

vi.mock('../../lib/state/state.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../../lib/state/state.js')
	>();

	return {
		...actual,
		getSafeState: () =>
			succeeded('Resolved safe state', {
				nodes,
				rootNodeId: 'workspace-1',
				contextNode: nodes['swimlane-1'],
				selectedIndex: 0,
				tags: {
					'tag-1': {id: 'tag-1', name: 'bug'},
				},
				contributors: contributorRegistry,
				eventLog: stateEventLog,
				syncStatus: {
					status: 'synced',
					msg: 'Synced',
				},
			}),
		getRenderedChildren: (id: string) =>
			Object.values(nodes).filter(
				node => !node.isDeleted && node.parentNodeId === id,
			),
	};
});

vi.mock('../../lib/repository/node-repo.js', () => ({
	nodeRepo: {
		getNode: vi.fn((id: string) => nodes[id]),
		getTag: vi.fn((id: string) =>
			id === 'tag-1' ? {id: 'tag-1', name: 'bug'} : undefined,
		),
		getContributor: vi.fn((id: string) => contributorRegistry[id]),
		getCommentsByIssue: vi.fn(() => []),
		getAttachmentsByIssue: vi.fn(() => []),
	},
}));

vi.mock('../epiq-time-travel.js', () => ({
	getTimeTravelStatus: vi.fn(() => ({mode: 'live', asOfTime: null})),
	// Stand-in for the real tree walk; fixtures carry boardId on the payload.
	filterEventsForBoard: vi.fn(
		(events: {payload?: {boardId?: string}}[], boardId: string) =>
			events.filter(event => event.payload?.boardId === boardId),
	),
}));

vi.mock('../../lib/event/common-events.js', () => ({
	createIssueEvents: vi.fn(({name, parent, user, rank}) =>
		succeeded('Created issue events', [
			{
				id: 'event-create-1',
				userId: user.userId,
				userName: user.userName,
				action: 'add.issue',
				payload: {
					id: 'issue-created-1',
					name,
					parent,
					rank,
				},
			},
		]),
	),
}));

let tools: typeof import('../epiq-api.js');
let persistModule: typeof import('../../lib/event/event-materialize-and-persist.js');
let timeTravelModule: typeof import('../epiq-time-travel.js');
let gitUtilsModule: typeof import('../../git/git-utils.js');

beforeAll(async () => {
	tools = await import('../epiq-api.js');
	persistModule = await import(
		'../../lib/event/event-materialize-and-persist.js'
	);
	timeTravelModule = await import('../epiq-time-travel.js');
	gitUtilsModule = await import('../../git/git-utils.js');
});

describe('mcp tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetContributorFixtures();
	});

	it('lists boards', async () => {
		const result = await tools.listBoards({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual([
				{
					id: 'board-1',
					ref: 'BOARD-1',
					title: 'Default',
					parentId: 'workspace-1',
					readonly: false,
				},
				{
					id: 'board-2',
					ref: 'BOARD-2',
					title: 'Other board',
					parentId: 'workspace-1',
					readonly: false,
				},
			]);
		}
	});

	it('does not pull from remote when listing boards, swimlanes, issues, or state (#80)', async () => {
		await tools.listBoards({repoRoot: '/repo'});
		await tools.listSwimlanes({repoRoot: '/repo'});
		await tools.listIssues({repoRoot: '/repo', includeClosed: false});
		await tools.getEpiqState({repoRoot: '/repo'});

		const pullCalls = vi
			.mocked(gitUtilsModule.execGit)
			.mock.calls.filter(([call]) => call.args.includes('pull'));

		expect(pullCalls).toEqual([]);
	});

	it('does not pull from remote when writing either, e.g. creating or tagging an issue (#80)', async () => {
		await tools.createIssue({
			repoRoot: '/repo',
			title: 'New issue',
			parentId: 'swimlane-1',
		});
		await tools.addIssueTag({
			repoRoot: '/repo',
			issueId: 'issue-1',
			tagName: 'urgent',
		});

		const pullCalls = vi
			.mocked(gitUtilsModule.execGit)
			.mock.calls.filter(([call]) => call.args.includes('pull'));

		expect(pullCalls).toEqual([]);
	});

	it('lists swimlanes', async () => {
		const result = await tools.listSwimlanes({
			repoRoot: '/repo',
			boardId: 'board-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.map(swimlane => swimlane.id)).toEqual([
				'swimlane-1',
				'swimlane-2',
				'readonly-swimlane',
			]);
		}
	});

	it('creates a swimlane on a board', async () => {
		const result = await tools.createSwimlane({
			repoRoot: '/repo',
			boardId: 'board-1',
			title: 'Backlog',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: expect.any(String),
				title: 'Backlog',
				boardId: 'board-1',
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'add.swimlane',
					payload: expect.objectContaining({
						name: 'Backlog',
						parent: 'board-1',
						rank: expect.any(String),
					}),
				}),
			],
			'/state',
		);
	});

	it('fails creating a swimlane when the target parent is not a board', async () => {
		const result = await tools.createSwimlane({
			repoRoot: '/repo',
			boardId: 'swimlane-1',
			title: 'Backlog',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Target parent must be a board');
		}
	});

	it('edits a swimlane title', async () => {
		const result = await tools.editSwimlaneTitle({
			repoRoot: '/repo',
			swimlaneId: 'swimlane-1',
			title: 'In review',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({id: 'swimlane-1', title: 'In review'});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'edit.title',
					payload: {id: 'swimlane-1', name: 'In review'},
				}),
			],
			'/state',
		);
	});

	it('fails editing a readonly swimlane title', async () => {
		const result = await tools.editSwimlaneTitle({
			repoRoot: '/repo',
			swimlaneId: 'readonly-swimlane',
			title: 'Renamed',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot edit readonly swimlane');
		}
	});

	it('fails editing a swimlane title when target is not a swimlane', async () => {
		const result = await tools.editSwimlaneTitle({
			repoRoot: '/repo',
			swimlaneId: 'issue-1',
			title: 'Renamed',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Edit target must be a swimlane');
		}
	});

	it('moves a swimlane to another board', async () => {
		const result = await tools.moveSwimlane({
			repoRoot: '/repo',
			swimlaneId: 'swimlane-1',
			boardId: 'board-2',
			position: {at: 'start'},
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'swimlane-1',
				boardId: 'board-2',
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'move.node',
					payload: expect.objectContaining({
						id: 'swimlane-1',
						parent: 'board-2',
						rank: expect.any(String),
					}),
				}),
			],
			'/state',
		);
	});

	it('deletes a swimlane', async () => {
		const result = await tools.deleteSwimlane({
			repoRoot: '/repo',
			swimlaneId: 'swimlane-2',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({id: 'swimlane-2'});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'delete.node',
					payload: {id: 'swimlane-2'},
				}),
			],
			'/state',
		);
	});

	it('fails deleting a swimlane when target is not a swimlane', async () => {
		const result = await tools.deleteSwimlane({
			repoRoot: '/repo',
			swimlaneId: 'issue-1',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Delete target must be a swimlane');
		}
	});

	it('lists issues', async () => {
		const result = await tools.listIssues({
			repoRoot: '/repo',
			includeClosed: false,
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.map(issue => issue.id).sort()).toEqual([
				'issue-1',
				'issue-2',
			]);
			expect(result.value).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: 'issue-1',
						title: 'Fix bug',
						description: 'A bug description',
						parentNodeId: 'swimlane-1',
						isClosed: false,
						readonly: false,
					}),
				]),
			);
		}
	});

	it('excludes deleted (tombstoned) nodes from boards, swimlanes, and issues', async () => {
		const boards = await tools.listBoards({repoRoot: '/repo'});
		const swimlanes = await tools.listSwimlanes({repoRoot: '/repo'});
		const issues = await tools.listIssues({
			repoRoot: '/repo',
			includeClosed: true,
		});

		expect(isFail(boards)).toBe(false);
		expect(isFail(swimlanes)).toBe(false);
		expect(isFail(issues)).toBe(false);
		if (!isFail(boards)) {
			expect(boards.value.some(b => b.id === 'deleted-board')).toBe(false);
		}
		if (!isFail(swimlanes)) {
			expect(swimlanes.value.some(s => s.id === 'deleted-swimlane')).toBe(
				false,
			);
		}
		if (!isFail(issues)) {
			expect(issues.value.some(i => i.id === 'deleted-issue')).toBe(false);
		}
	});

	it('scopes issues to a single board via boardId', async () => {
		const boardOne = await tools.listIssues({
			repoRoot: '/repo',
			includeClosed: false,
			boardId: 'board-1',
		});
		const boardTwo = await tools.listIssues({
			repoRoot: '/repo',
			includeClosed: false,
			boardId: 'board-2',
		});

		expect(isFail(boardOne)).toBe(false);
		expect(isFail(boardTwo)).toBe(false);
		if (!isFail(boardOne) && !isFail(boardTwo)) {
			expect(boardOne.value.map(issue => issue.id)).toEqual(['issue-1']);
			expect(boardTwo.value.map(issue => issue.id)).toEqual(['issue-2']);
		}
	});

	it('creates an issue', async () => {
		const result = await tools.createIssue({
			repoRoot: '/repo',
			title: 'New issue',
			parentId: 'swimlane-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-created-1',
				title: 'New issue',
				parentId: 'swimlane-1',
				description: '',
				tags: [],
				assignees: [],
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'add.issue',
					payload: expect.objectContaining({
						id: 'issue-created-1',
						parent: 'swimlane-1',
						rank: 'm0',
					}),
				}),
			],
			'/state',
		);
	});

	it('creates an issue with description, tags, and assignees atomically', async () => {
		const result = await tools.createIssue({
			repoRoot: '/repo',
			title: 'New issue',
			parentId: 'swimlane-1',
			description: 'Some details',
			tagNames: ['bug', 'urgent'],
			assigneeNames: ['Alice', 'Bob'],
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-created-1',
				title: 'New issue',
				parentId: 'swimlane-1',
				description: 'Some details',
				tags: [
					{id: 'tag-1', name: 'bug'},
					{id: expect.any(String), name: 'urgent'},
				],
				assignees: [
					{id: 'contributor-1', name: 'Alice'},
					{id: expect.any(String), name: 'Bob'},
				],
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledTimes(1);
		const [events] = vi.mocked(persistModule.materializeAndPersistAll).mock
			.calls[0]!;
		expect(events.map(event => event.action)).toEqual([
			'add.issue',
			'edit.description',
			'add.issue.tag',
			'create.tag',
			'add.issue.tag',
			'add.issue.assignee',
			'create.contributor',
			'add.issue.assignee',
		]);
	});

	it('fails creating an issue when parent is missing', async () => {
		const result = await tools.createIssue({
			repoRoot: '/repo',
			title: 'New issue',
			parentId: 'missing',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Unable to locate parent swimlane: missing');
		}
	});

	it('closes an issue', async () => {
		const result = await tools.closeIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-1',
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'close.issue',
					payload: expect.objectContaining({
						id: 'issue-1',
						rank: 'm0',
					}),
				}),
			],
			'/state',
		);
	});

	it('moves an issue', async () => {
		const result = await tools.moveIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
			parentId: 'swimlane-2',
			position: {at: 'start'},
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-1',
				parentId: 'swimlane-2',
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'move.node',
					payload: expect.objectContaining({
						id: 'issue-1',
						parent: 'swimlane-2',
						rank: expect.any(String),
					}),
				}),
			],
			'/state',
		);
	});

	it('fails moving to readonly swimlane', async () => {
		const result = await tools.moveIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
			parentId: 'readonly-swimlane',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move issue to readonly swimlane');
		}
	});

	it('gets full Epiq state', async () => {
		const result = await tools.getEpiqState({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.root).toBe('/repo');
			expect(result.value.stateBranchRoot).toBe('/state');
			expect(result.value.rootNodeId).toBe('workspace-1');
			expect(result.value.nodes).toBe(nodes);
		}
	});

	it('gets GUI state without re-booting (pulling/re-materializing live) while time-travel is active', async () => {
		vi.mocked(timeTravelModule.getTimeTravelStatus).mockReturnValueOnce({
			mode: 'scrub',
			asOfTime: 123,
		});

		const result = await tools.getGuiState({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		// No git call means no boot, which is what proves the checkout survived.
		expect(gitUtilsModule.execGit).not.toHaveBeenCalled();
	});

	it('boots (re-materializes live) normally when not time-traveling, without pulling', async () => {
		const result = await tools.getGuiState({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		expect(gitUtilsModule.execGit).not.toHaveBeenCalled();
	});

	it('edits an issue title', async () => {
		const result = await tools.editIssueTitle({
			repoRoot: '/repo',
			issueId: 'issue-1',
			title: 'Fix critical bug',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({id: 'issue-1', title: 'Fix critical bug'});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'Fix critical bug'},
				}),
			],
			'/state',
		);
	});

	it('skips persist when title is unchanged', async () => {
		const result = await tools.editIssueTitle({
			repoRoot: '/repo',
			issueId: 'issue-1',
			title: 'Fix bug',
		});

		expect(isFail(result)).toBe(false);
		expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
	});

	it('adds a new tag to an issue, creating the tag', async () => {
		const result = await tools.addIssueTag({
			repoRoot: '/repo',
			issueId: 'issue-1',
			tagName: 'enhancement',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.tag.name).toBe('enhancement');
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({action: 'create.tag'}),
				expect.objectContaining({action: 'add.issue.tag'}),
			]),
		);
	});

	it('adds an existing tag to an issue without creating a duplicate', async () => {
		const result = await tools.addIssueTag({
			repoRoot: '/repo',
			issueId: 'issue-1',
			tagName: 'bug',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.tag).toEqual({id: 'tag-1', name: 'bug'});
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual([
			expect.objectContaining({
				action: 'add.issue.tag',
				payload: {id: 'issue-1', tag: 'tag-1'},
			}),
		]);
	});

	it('removes a tag from an issue', async () => {
		const result = await tools.removeIssueTag({
			repoRoot: '/repo',
			issueId: 'issue-1',
			tagId: 'tag-1',
		});

		expect(isFail(result)).toBe(false);
		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'remove.issue.tag',
					payload: {id: 'issue-1', tag: 'tag-1'},
				}),
			],
			'/state',
		);
	});

	it('fails removing a tag that does not exist', async () => {
		const result = await tools.removeIssueTag({
			repoRoot: '/repo',
			issueId: 'issue-1',
			tagId: 'missing-tag',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Tag not found');
		}
	});

	it('creates an unlinked assignee from a name when explicitly asked', async () => {
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeName: 'Bob',
			createUnlinked: true,
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.assignee.name).toBe('Bob');
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({action: 'create.contributor'}),
				expect.objectContaining({action: 'add.issue.assignee'}),
			]),
		);
	});

	it('derives contributors from event-log userIds, not just the registry', async () => {
		// boot() also calls loadMergedEvents, so a `once` override gets swallowed.
		// Restore the default at the end: clearAllMocks does not reset
		// implementations, so a leak here would change every later test.
		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'user-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
				// Same person, later event, new display name: the latest wins.
				{
					id: 'e2',
					userId: 'user-1',
					userName: 'Alice Cooper',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'y'},
				},
				{
					id: 'e3',
					userId: 'user-2',
					userName: 'Bob',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'z'},
				},
			]),
		);

		const result = await tools.getBoardContributors({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			const byId = Object.fromEntries(result.value.map(c => [c.id, c.name]));
			expect(byId['user-1']).toBe('Alice Cooper');
			expect(byId['user-2']).toBe('Bob');
			expect(byId['contributor-1']).toBe('Alice');
		}

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('assigns self using the config userId, registering that exact id', async () => {
		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'user-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
			]),
		);

		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			self: true,
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.assignee.id).toBe('user-1');
		}

		// Guards against minting a fresh ulid for somebody who already has an id.
		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual([
			expect.objectContaining({
				action: 'create.contributor',
				payload: {id: 'user-1', name: 'Alice'},
			}),
			expect.objectContaining({
				action: 'add.issue.assignee',
				payload: {id: 'issue-1', assignee: 'user-1'},
			}),
		]);

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('marks registry-only contributors as external, authors as not', async () => {
		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'user-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
			]),
		);

		const result = await tools.getBoardContributors({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			const byId = Object.fromEntries(
				result.value.map(c => [c.id, c.isExternal]),
			);
			expect(byId['user-1']).toBe(false);
			expect(byId['contributor-1']).toBe(true);
		}

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('removes an external contributor, keeping the id', async () => {
		const result = await tools.tombstoneContributor({
			repoRoot: '/repo',
			contributorId: 'contributor-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.id).toBe('contributor-1');
			expect(result.value.name).toBe(REMOVED_CONTRIBUTOR_NAME);
		}

		// A forward event: nothing in the log is rewritten.
		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual([
			expect.objectContaining({
				action: 'tombstone.contributor',
				payload: {id: 'contributor-1'},
			}),
		]);
	});

	describe('restoreContributor', () => {
		const asTombstoned = () => {
			contributorRegistry['contributor-1'] = {
				id: 'contributor-1',
				name: REMOVED_CONTRIBUTOR_NAME,
				tombstoned: true,
			};
		};

		const logWithCreate = (name: string) =>
			(
				eventLoadModule.loadMergedEvents as ReturnType<typeof vi.fn>
			).mockReturnValue(
				succeeded('loaded', [
					{
						id: 'create-1',
						userId: 'someone-else',
						userName: 'Someone Else',
						action: 'create.contributor',
						payload: {id: 'contributor-1', name},
					},
				]),
			);

		it('puts back the name the contributor was created under', async () => {
			asTombstoned();
			logWithCreate('Temp Tester');

			const result = await tools.restoreContributor({
				repoRoot: '/repo',
				contributorId: 'contributor-1',
			});

			expect(isFail(result)).toBe(false);
			if (!isFail(result)) {
				expect(result.value).toEqual({
					id: 'contributor-1',
					name: 'Temp Tester',
				});
			}

			// The name rides in the payload, so replay does not depend on what
			// else is in the log.
			const calls = (
				persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
			).mock.calls[0]?.[0];
			expect(calls).toEqual([
				expect.objectContaining({
					action: 'restore.contributor',
					payload: {id: 'contributor-1', name: 'Temp Tester'},
				}),
			]);
		});

		it('refuses a contributor who is not tombstoned', async () => {
			logWithCreate('Alice');

			const result = await tools.restoreContributor({
				repoRoot: '/repo',
				contributorId: 'contributor-1',
			});

			expect(isFail(result)).toBe(true);
			if (isFail(result)) {
				expect(result.message).toBe('Contributor is not tombstoned');
			}

			expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
		});

		it('refuses when the log has no create.contributor to read', async () => {
			asTombstoned();
			(
				eventLoadModule.loadMergedEvents as ReturnType<typeof vi.fn>
			).mockReturnValue(succeeded('loaded', []));

			const result = await tools.restoreContributor({
				repoRoot: '/repo',
				contributorId: 'contributor-1',
			});

			expect(isFail(result)).toBe(true);
			if (isFail(result)) {
				expect(result.message).toContain('no original name');
			}

			expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
		});

		it('refuses an unknown contributor', async () => {
			const result = await tools.restoreContributor({
				repoRoot: '/repo',
				contributorId: 'nobody',
			});

			expect(isFail(result)).toBe(true);
			if (isFail(result)) {
				expect(result.message).toBe('Contributor not found');
			}
		});
	});

	// The state a stale local log can produce: cleared, yet an author.
	// Guards against a later sync quietly restoring somebody: the log still
	// carries the name they authored under, so the registry has to win.
	it('keeps a tombstoned name cleared even when the log carries the real one', async () => {
		contributorRegistry['contributor-1'] = {
			id: 'contributor-1',
			name: REMOVED_CONTRIBUTOR_NAME,
			tombstoned: true,
		};

		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'contributor-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
			]),
		);

		const result = await tools.getBoardContributors({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			const tombstoned = result.value.find(c => c.id === 'contributor-1');
			expect(tombstoned?.name).toBe(REMOVED_CONTRIBUTOR_NAME);
			expect(tombstoned?.isRemoved).toBe(true);
		}

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	// `isExternal` is board-scoped, the removal guard is workspace-wide; a
	// client that conflates them offers a teammate the server then refuses.
	it('separates board-scoped external from workspace-wide authorship', async () => {
		// Registered, since the candidate list is board authors plus the
		// registry — that is what makes an off-board author reachable here.
		contributorRegistry['user-elsewhere'] = {
			id: 'user-elsewhere',
			name: 'Elsewhere',
		};

		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'user-here',
					userName: 'Here',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x', boardId: 'board-1'},
				},
				{
					id: 'e2',
					userId: 'user-elsewhere',
					userName: 'Elsewhere',
					action: 'edit.title',
					payload: {id: 'issue-2', name: 'y', boardId: 'board-2'},
				},
			]),
		);

		const result = await tools.getBoardContributors({
			repoRoot: '/repo',
			boardId: 'board-1',
		});

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		const byId = Object.fromEntries(result.value.map(c => [c.id, c]));

		expect(byId['user-here']?.isExternal).toBe(false);
		expect(byId['user-here']?.hasAuthoredAnywhere).toBe(true);

		// External to this board, but an author elsewhere, so not clearable.
		expect(byId['user-elsewhere']?.isExternal).toBe(true);
		expect(byId['user-elsewhere']?.hasAuthoredAnywhere).toBe(true);

		// Registry-only, so the one genuinely clearable case.
		expect(byId['contributor-1']?.isExternal).toBe(true);
		expect(byId['contributor-1']?.hasAuthoredAnywhere).toBe(false);

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('keeps a tombstoned assignee cleared on issues the log names them in', async () => {
		contributorRegistry['contributor-1'] = {
			id: 'contributor-1',
			name: REMOVED_CONTRIBUTOR_NAME,
			tombstoned: true,
		};

		// The competing name the log-name override would otherwise promote.
		stateEventLog = [
			...DEFAULT_STATE_EVENT_LOG,
			{
				id: 'e-tombstoned',
				userId: 'contributor-1',
				userName: 'Alice',
				action: 'edit.title',
				payload: {id: 'issue-1', name: 'x'},
			},
		];

		const result = await tools.listIssues({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			const assignees = result.value.flatMap(issue => issue.assignees);
			const tombstoned = assignees.find(a => a.id === 'contributor-1');
			expect(tombstoned).toBeDefined();
			expect(tombstoned?.name).toBe(REMOVED_CONTRIBUTOR_NAME);
		}
	});

	it('refuses to remove a contributor who has authored events', async () => {
		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'contributor-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
			]),
		);

		const result = await tools.tombstoneContributor({
			repoRoot: '/repo',
			contributorId: 'contributor-1',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('authored events');
		}

		expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('marks self in the contributor list', async () => {
		const loadMerged = eventLoadModule.loadMergedEvents as ReturnType<
			typeof vi.fn
		>;
		loadMerged.mockReturnValue(
			succeeded('loaded', [
				{
					id: 'e1',
					userId: 'user-1',
					userName: 'Alice',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'x'},
				},
				{
					id: 'e2',
					userId: 'user-2',
					userName: 'Bob',
					action: 'edit.title',
					payload: {id: 'issue-1', name: 'y'},
				},
			]),
		);

		const result = await tools.getBoardContributors({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			const self = result.value.filter(c => c.isSelf);
			expect(self).toHaveLength(1);
			expect(self[0]?.id).toBe('user-1');
		}

		loadMerged.mockReturnValue(succeeded('loaded', []));
	});

	it('assigns by id without creating a contributor', async () => {
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeId: 'contributor-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.assignee).toEqual({
				id: 'contributor-1',
				name: 'Alice',
			});
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual([
			expect.objectContaining({
				action: 'add.issue.assignee',
				payload: {id: 'issue-1', assignee: 'contributor-1'},
			}),
		]);
	});

	it('fails on an unknown assignee id instead of creating one', async () => {
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeId: 'contributor-missing',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Unknown assignee id');
		}

		expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
	});

	it('fails when neither an assignee id nor a name is given', async () => {
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Provide assigneeId, self or assigneeName');
		}
	});

	// Guards against a misspelt name silently creating a near-duplicate person.
	it('refuses an unmatched name unless createUnlinked is set', async () => {
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeName: 'Nobody',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('createUnlinked');
		}

		expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
	});

	it('adds an existing contributor as assignee without creating a duplicate', async () => {
		// The default log author is a separate id sharing the registry's display
		// name, which the union correctly reads as two people called Alice.
		stateEventLog = [{...DEFAULT_STATE_EVENT_LOG[0], userId: 'contributor-1'}];

		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeName: 'Alice',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.assignee).toEqual({
				id: 'contributor-1',
				name: 'Alice',
			});
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];
		expect(calls).toEqual([
			expect.objectContaining({
				action: 'add.issue.assignee',
				payload: {id: 'issue-1', assignee: 'contributor-1'},
			}),
		]);
	});

	// Guards against minting a second id for an author absent from the registry.
	it('matches a name found only in the event log and reuses that id', async () => {
		stateEventLog = [
			{
				id: 'event-1',
				userId: 'log-only-author',
				userName: 'Log Only',
				action: 'edit.title',
				payload: {id: 'issue-1', name: 'x'},
			},
		];

		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeName: 'Log Only',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.assignee).toEqual({
				id: 'log-only-author',
				name: 'Log Only',
			});
		}

		const calls = (
			persistModule.materializeAndPersistAll as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[0];

		expect(calls).toEqual([
			expect.objectContaining({
				action: 'create.contributor',
				payload: {id: 'log-only-author', name: 'Log Only'},
			}),
			expect.objectContaining({
				action: 'add.issue.assignee',
				payload: {id: 'issue-1', assignee: 'log-only-author'},
			}),
		]);
	});

	it('refuses a name that matches two different contributors', async () => {
		// Registry "Alice" (contributor-1) and log author "Alice" (user-1) are
		// two ids with one display name.
		const result = await tools.addIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeName: 'Alice',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('matches 2 contributors');
			expect(result.message).toContain('assigneeId');
		}

		expect(persistModule.materializeAndPersistAll).not.toHaveBeenCalled();
	});

	it('removes an assignee from an issue', async () => {
		const result = await tools.removeIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeId: 'contributor-1',
		});

		expect(isFail(result)).toBe(false);
		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'remove.issue.assignee',
					payload: {id: 'issue-1', assignee: 'contributor-1'},
				}),
			],
			'/state',
		);
	});

	it('fails removing an assignee that does not exist', async () => {
		const result = await tools.removeIssueAssignee({
			repoRoot: '/repo',
			issueId: 'issue-1',
			assigneeId: 'missing-contributor',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Assignee not found');
		}
	});

	it('adds a comment to an issue', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: 'Looks good to me',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.body).toBe('Looks good to me');
			expect(result.value.issueId).toBe('issue-1');
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'add.issue.comment',
					payload: expect.objectContaining({
						issue: 'issue-1',
						md: 'Looks good to me',
					}),
				}),
			],
			'/state',
		);
	});

	it('fails adding an empty comment', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: '   ',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Comment cannot be empty');
		}
	});

	it('fails adding a comment past the shared limit', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: 'x'.repeat(MAX_COMMENT_LENGTH + 1),
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain(String(MAX_COMMENT_LENGTH));
		}
	});

	it('accepts a comment of exactly the shared limit', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: 'x'.repeat(MAX_COMMENT_LENGTH),
		});

		expect(isFail(result)).toBe(false);
	});

	it('accepts a comment of a thousand characters', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: 'x'.repeat(1000),
		});

		expect(isFail(result)).toBe(false);
	});

	it('measures the trimmed body, not the raw input', async () => {
		const result = await tools.addIssueComment({
			repoRoot: '/repo',
			issueId: 'issue-1',
			body: `   ${'x'.repeat(MAX_COMMENT_LENGTH)}   `,
		});

		expect(isFail(result)).toBe(false);
	});

	it('deletes a comment', async () => {
		const result = await tools.deleteIssueComment({
			repoRoot: '/repo',
			commentId: 'comment-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({id: 'comment-1', issueId: 'issue-1'});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'delete.issue.comment',
					payload: {id: 'comment-1', issue: 'issue-1'},
				}),
			],
			'/state',
		);
	});

	it('fails deleting a comment that does not exist', async () => {
		const result = await tools.deleteIssueComment({
			repoRoot: '/repo',
			commentId: 'no-such-comment',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Unable to resolve comment');
		}
	});

	it('reopens a closed issue to its previous swimlane', async () => {
		const result = await tools.reopenIssue({
			repoRoot: '/repo',
			issueId: 'issue-closed-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-closed-1',
				parentId: 'swimlane-1',
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'reopen.issue',
					payload: expect.objectContaining({
						id: 'issue-closed-1',
						parent: 'swimlane-1',
					}),
				}),
			],
			'/state',
		);
	});

	it('fails reopening an issue that is not closed', async () => {
		const result = await tools.reopenIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Issue is not closed');
		}
	});
});
