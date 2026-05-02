import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {isFail, Result} from '../../lib/model/result-types.js';

vi.mock('../../lib/storage/paths.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../../lib/storage/paths.js')
	>();

	return {
		...actual,
		resolveClosestEpiqRoot: vi.fn((dir: string) => ({
			status: 'success',
			message: 'Resolved closest .epiq root',
			value: dir,
		})),
		ensureEventsDir: vi.fn(() => ({
			status: 'success',
			message: 'Ensured events directory',
			value: undefined,
		})),
	};
});

vi.mock('../../event/event-load.js', () => ({
	loadMergedEvents: vi.fn(() => ({
		status: 'success',
		message: 'loaded',
		value: [],
	})),
}));

vi.mock('../../event/event-boot.js', () => ({
	bootStateFromEventLog: vi.fn(() => ({
		status: 'success',
		message: 'booted',
		value: null,
	})),
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

vi.mock('../../event/event-materialize-and-persist.js', () => ({
	materializeAndPersistAll: vi.fn(() => [
		{
			status: 'success',
			message: 'persisted',
			value: null,
		},
	]),
}));

const nodes: Record<string, any> = {
	'board-1': {
		id: 'board-1',
		title: 'Default',
		context: 'BOARD',
		parentNodeId: 'workspace-1',
		readonly: false,
	},
	'swimlane-1': {
		id: 'swimlane-1',
		title: 'Todo',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: false,
	},
	'swimlane-2': {
		id: 'swimlane-2',
		title: 'Review',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: false,
	},
	'readonly-swimlane': {
		id: 'readonly-swimlane',
		title: 'Locked',
		context: 'SWIMLANE',
		parentNodeId: 'board-1',
		readonly: true,
	},
	'issue-1': {
		id: 'issue-1',
		title: 'Fix bug',
		context: 'TICKET',
		parentNodeId: 'swimlane-1',
		readonly: false,
	},
	'field-description': {
		id: 'field-description',
		title: 'Description',
		context: 'FIELD',
		parentNodeId: 'issue-1',
		props: {value: 'A bug description'},
	},
};

vi.mock('../../lib/state/state.js', () => ({
	getState: () => ({
		nodes,
		rootNodeId: 'workspace-1',
		currentNode: nodes['swimlane-1'],
		selectedIndex: 0,
		eventLog: [],
	}),
	getRenderedChildren: (id: string) => {
		if (id === 'issue-1') return [nodes['field-description']];
		return Object.values(nodes).filter(node => node.parentNodeId === id);
	},
}));

vi.mock('../../repository/node-repo.js', () => ({
	nodeRepo: {
		getNode: vi.fn((id: string) => nodes[id]),
		getTag: vi.fn(() => undefined),
		getContributor: vi.fn(() => undefined),
	},
}));

vi.mock('../../event/event-materialize-and-persist.js', () => ({
	materializeAndPersistAll: vi.fn(() => [
		{
			result: 'success',
			message: 'persisted',
			data: null,
		},
	]),
}));

vi.mock('../../event/common-events.js', () => ({
	createIssueEvents: vi.fn(({name, parent, user}) => [
		{
			id: 'event-create-1',
			userId: user.userId,
			userName: user.userName,
			action: 'add.issue',
			payload: {
				id: 'issue-created-1',
				name,
				parent,
			},
		},
	]),
}));

let tools: typeof import('../tools.js');
let persistModule: typeof import('../../event/event-materialize-and-persist.js');

beforeAll(async () => {
	tools = await import('../tools.js');
	persistModule = await import('../../event/event-materialize-and-persist.js');
});

describe('mcp tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('lists boards', () => {
		const result = tools.listBoards({repoRoot: '/repo'});

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

	it('lists swimlanes', () => {
		const result = tools.listSwimlanes({
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

	it('lists issues', () => {
		const result = tools.listIssues({
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
					parentId: 'swimlane-1',
					isClosed: false,
					readonly: false,
				}),
			]);
		}
	});

	it('creates an issue', () => {
		const result = tools.createIssue({
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
	});

	it('fails creating an issue when parent is missing', () => {
		const result = tools.createIssue({
			repoRoot: '/repo',
			title: 'New issue',
			parentId: 'missing',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Unable to locate parent swimlane: missing');
		}
	});

	it('closes an issue', () => {
		const result = tools.closeIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value).toEqual({
				id: 'issue-1',
				closed: true,
			});
		}
	});

	it('moves an issue', () => {
		const result = tools.moveIssue({
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
				position: {at: 'start'},
			});
		}

		expect(persistModule.materializeAndPersistAll).toHaveBeenCalledWith([
			expect.objectContaining({
				action: 'move.node',
				payload: {
					id: 'issue-1',
					parent: 'swimlane-2',
					pos: {at: 'start'},
				},
			}),
		]);
	});

	it('fails moving to readonly swimlane', () => {
		const result = tools.moveIssue({
			repoRoot: '/repo',
			issueId: 'issue-1',
			parentId: 'readonly-swimlane',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move issue to readonly swimlane');
		}
	});

	it('gets full Epiq state', () => {
		const result = tools.getEpiqState({repoRoot: '/repo'});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value.root).toBe('/repo');
			expect(result.value.rootNodeId).toBe('workspace-1');
			expect(result.value.nodes).toBe(nodes);
		}
	});
});
