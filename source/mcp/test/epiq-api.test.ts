import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
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

vi.mock('../../lib/event/event-boot.js', () => ({
	bootStateFromEventLog: vi.fn(() => succeeded('booted', null)),
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
			tags: [],
			assignees: [],
		},
	},
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
				eventLog: [],
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
		getTag: vi.fn(() => undefined),
		getContributor: vi.fn(() => undefined),
	},
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

beforeAll(async () => {
	tools = await import('../epiq-api.js');
	persistModule = await import(
		'../../lib/event/event-materialize-and-persist.js'
	);
});

describe('mcp tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists boards', async () => {
		const result = await tools.listBoards({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual([
				{
					id: 'board-1',
					title: 'Default',
					parentId: 'workspace-1',
					readonly: false,
				},
			]);
		}
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

	it('lists issues', async () => {
		const result = await tools.listIssues({
			repoRoot: '/repo',
			includeClosed: false,
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual([
				expect.objectContaining({
					id: 'issue-1',
					title: 'Fix bug',
					description: 'A bug description',
					parentNodeId: 'swimlane-1',
					isClosed: false,
					readonly: false,
				}),
			]);
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
});
