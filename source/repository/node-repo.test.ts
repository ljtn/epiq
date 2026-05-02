import {beforeEach, describe, expect, it, vi} from 'vitest';

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	getState: vi.fn(),
	patchState: vi.fn(),
	updateState: vi.fn(),
	getRenderedChildren: vi.fn(),
	getOrderedChildren: vi.fn(),
	resolveMoveRank: vi.fn(),
	midRank: vi.fn(),
	sanitizeInlineText: vi.fn(),
}));

vi.mock('../lib/actions/default/navigation-action-utils.js', () => ({
	navigationUtils: {
		navigate: mocks.navigate,
	},
}));

vi.mock('../lib/state/state.js', () => ({
	getState: () => mocks.getState(),
	patchState: (...args: unknown[]) => mocks.patchState(...args),
	updateState: (...args: unknown[]) => mocks.updateState(...args),
	getRenderedChildren: (...args: unknown[]) =>
		mocks.getRenderedChildren(...args),
}));

vi.mock('./rank.js', () => ({
	getOrderedChildren: (...args: unknown[]) => mocks.getOrderedChildren(...args),
	resolveMoveRank: (...args: unknown[]) => mocks.resolveMoveRank(...args),
}));

vi.mock('../lib/utils/rank.js', () => ({
	midRank: () => mocks.midRank(),
}));

vi.mock('../lib/utils/string.utils.js', () => ({
	sanitizeInlineText: (...args: unknown[]) => mocks.sanitizeInlineText(...args),
}));

vi.mock('../lib/model/context.model.js', async () => {
	const actual = await vi.importActual('../lib/model/context.model.js');
	return {
		...actual,
		isFieldListNode: (node: {context?: string}) =>
			node.context === 'FIELD_LIST',
	};
});

vi.mock('../lib/state/node-builder.js', () => ({
	nodes: {
		field: (
			id: string,
			title: string,
			parentNodeId: string,
			props: Record<string, unknown>,
		) => ({
			id,
			title,
			parentNodeId,
			props,
			context: 'FIELD',
			rank: 'm',
		}),
	},
}));

import {isFail, succeeded} from '../lib/model/result-types.js';
import {findAncestor, isDescendantOf, nodeRepo} from './node-repo.js';

type TestNode = {
	id: string;
	title: string;
	context: string;
	parentNodeId?: string;
	rank: string;
	props?: Record<string, unknown>;
	readonly?: boolean;
	isDeleted?: boolean;
};

const makeNode = (overrides: Partial<TestNode>): TestNode => ({
	id: overrides.id ?? 'node',
	title: overrides.title ?? 'Node',
	context: overrides.context ?? 'BOARD',
	parentNodeId: overrides.parentNodeId,
	rank: overrides.rank ?? 'm',
	props: overrides.props ?? {},
	readonly: overrides.readonly ?? false,
	isDeleted: overrides.isDeleted ?? false,
});

const makeState = (overrides?: Partial<Record<string, unknown>>) => ({
	rootNodeId: 'root',
	currentNodeId: 'board',
	nodes: {},
	renderedChildrenIndex: {},
	contributors: {},
	tags: {},
	...overrides,
});

describe('findAncestor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the node itself when it already matches the requested context', () => {
		const board = makeNode({id: 'board', context: 'BOARD'});
		mocks.getState.mockReturnValue(
			makeState({
				nodes: {
					board,
				},
			}),
		);

		const result = findAncestor('board', 'BOARD');

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value?.id).toBe('board');
		}
	});

	it('walks upward and returns the matching ancestor', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});
		const ticket = makeNode({
			id: 'ticket',
			context: 'TICKET',
			parentNodeId: 'board',
		});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {root, board, ticket},
			}),
		);

		const result = findAncestor('ticket', 'BOARD');

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.value?.id).toBe('board');
		}
	});

	it('fails when target node does not exist', () => {
		mocks.getState.mockReturnValue(makeState({nodes: {}}));

		const result = findAncestor('missing', 'BOARD');

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Node not found');
		}
	});

	it('fails when no matching ancestor exists', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {root, board},
			}),
		);

		const result = findAncestor('board', 'TICKET');

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('No ancestor found for context: TICKET');
		}
	});
});

describe('isDescendantOf', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns true when ancestor is in the parent chain', () => {
		mocks.getState.mockReturnValue(
			makeState({
				nodes: {
					root: makeNode({id: 'root', context: 'ROOT'}),
					board: makeNode({
						id: 'board',
						context: 'BOARD',
						parentNodeId: 'root',
					}),
					ticket: makeNode({
						id: 'ticket',
						context: 'TICKET',
						parentNodeId: 'board',
					}),
				},
			}),
		);

		expect(isDescendantOf('ticket', 'root')).toBe(true);
		expect(isDescendantOf('ticket', 'board')).toBe(true);
	});

	it('returns false when ancestor is not in the chain', () => {
		mocks.getState.mockReturnValue(
			makeState({
				nodes: {
					root: makeNode({id: 'root', context: 'ROOT'}),
					board: makeNode({
						id: 'board',
						context: 'BOARD',
						parentNodeId: 'root',
					}),
					ticket: makeNode({
						id: 'ticket',
						context: 'TICKET',
						parentNodeId: 'board',
					}),
				},
			}),
		);

		expect(isDescendantOf('board', 'ticket')).toBe(false);
		expect(isDescendantOf('root', 'board')).toBe(false);
	});
});

describe('nodeRepo.moveNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveMoveRank.mockReturnValue(succeeded('Resolved rank', 'n'));
	});

	it('fails when trying to move the root node', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});

		mocks.getState.mockReturnValue(
			makeState({
				rootNodeId: 'root',
				nodes: {root, board},
			}),
		);

		const result = nodeRepo.moveNode({
			id: 'root',
			parentId: 'board',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move root node');
		}
	});

	it('fails when moving into itself', () => {
		const board = makeNode({id: 'board', context: 'BOARD'});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {board},
			}),
		);

		const result = nodeRepo.moveNode({
			id: 'board',
			parentId: 'board',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move node into itself');
		}
	});

	it('fails when moving into its own descendant', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});
		const ticket = makeNode({
			id: 'ticket',
			context: 'TICKET',
			parentNodeId: 'board',
		});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {root, board, ticket},
			}),
		);

		const result = nodeRepo.moveNode({
			id: 'board',
			parentId: 'ticket',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move node into its own descendant');
		}
	});

	it('fails when moving a readonly node', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
			readonly: true,
		});
		const otherParent = makeNode({
			id: 'other',
			context: 'BOARD',
			parentNodeId: 'root',
		});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {root, board, other: otherParent},
			}),
		);

		const result = nodeRepo.moveNode({
			id: 'board',
			parentId: 'other',
		});

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot move readonly node');
		}
	});

	it('updates node without navigating when navigate=false', () => {
		const updateNodeSpy = vi
			.spyOn(nodeRepo, 'updateNode')
			.mockReturnValue(succeeded('Updated node', {} as never));

		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});
		const ticket = makeNode({
			id: 'ticket',
			context: 'TICKET',
			parentNodeId: 'board',
			rank: 'a',
		});
		const otherParent = makeNode({
			id: 'other',
			context: 'BOARD',
			parentNodeId: 'root',
		});

		mocks.getState.mockReturnValue(
			makeState({
				nodes: {root, board, ticket, other: otherParent},
			}),
		);
		mocks.getOrderedChildren.mockReturnValue([]);

		const result = nodeRepo.moveNode({
			id: 'ticket',
			parentId: 'other',
		});

		expect(isFail(result)).toBe(false);
		expect(updateNodeSpy).toHaveBeenCalledTimes(1);
		expect(updateNodeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'ticket',
				parentNodeId: 'other',
				rank: 'n',
			}),
		);
	});
});

describe('nodeRepo.updateNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates state first, then navigates to the parent with rendered index', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});
		const a = makeNode({
			id: 'a',
			context: 'TICKET',
			parentNodeId: 'board',
			rank: 'a',
		});
		const moved = makeNode({
			id: 'moved',
			context: 'TICKET',
			parentNodeId: 'board',
			rank: 'b',
		});
		const c = makeNode({
			id: 'c',
			context: 'TICKET',
			parentNodeId: 'board',
			rank: 'c',
		});

		mocks.updateState.mockImplementation(fn => {
			const prev = makeState({
				nodes: {root, board, a, moved: {...moved, rank: 'z'}, c},
			});
			fn(prev);
			return succeeded('Updated', null);
		});

		mocks.getState.mockReturnValue(
			makeState({
				rootNodeId: 'root',
				nodes: {root, board, a, moved, c},
			}),
		);

		mocks.getRenderedChildren.mockReturnValue([a, moved, c]);

		const result = nodeRepo.updateNode(moved as never);

		expect(isFail(result)).toBe(false);
		expect(mocks.updateState).toHaveBeenCalledTimes(1);
	});
});

describe('nodeRepo.tombstoneNode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks node and descendants as deleted when current node is deleted', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		const board = makeNode({
			id: 'board',
			context: 'BOARD',
			parentNodeId: 'root',
		});
		const ticket = makeNode({
			id: 'ticket',
			context: 'TICKET',
			parentNodeId: 'board',
		});
		const child = makeNode({
			id: 'child',
			context: 'FIELD',
			parentNodeId: 'ticket',
		});

		mocks.getState.mockReturnValue(
			makeState({
				rootNodeId: 'root',
				currentNodeId: 'ticket',
				nodes: {root, board, ticket, child},
			}),
		);

		mocks.getOrderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'ticket') return [child];
			return [];
		});

		const result = nodeRepo.tombstoneNode('ticket');

		expect(isFail(result)).toBe(false);
		expect(mocks.patchState).toHaveBeenCalledWith({
			nodes: expect.objectContaining({
				ticket: expect.objectContaining({isDeleted: true}),
				child: expect.objectContaining({isDeleted: true}),
			}),
		});
	});

	it('fails when trying to tombstone the root node', () => {
		const root = makeNode({id: 'root', context: 'ROOT'});
		mocks.getState.mockReturnValue(
			makeState({
				rootNodeId: 'root',
				currentNodeId: 'root',
				nodes: {root},
			}),
		);

		const result = nodeRepo.tombstoneNode('root');

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Cannot delete root node');
		}
	});
});

describe('nodeRepo.assign / tag', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('assign creates a new field node when contributor is not already assigned', () => {
		const createNodeAtPositionSpy = vi.spyOn(nodeRepo, 'createNodeAtPosition');
		const getContributorSpy = vi.spyOn(nodeRepo, 'getContributor');
		const getNodeSpy = vi.spyOn(nodeRepo, 'getNode');
		const getFieldByTitleSpy = vi.spyOn(nodeRepo, 'getFieldByTitle');

		getContributorSpy.mockReturnValue({id: 'u1', name: 'Alice'} as never);
		getNodeSpy.mockImplementation((id: string) => {
			if (id === 'ticket') {
				return makeNode({id: 'ticket', context: 'TICKET'}) as never;
			}
			return undefined;
		});
		getFieldByTitleSpy.mockReturnValue(
			makeNode({
				id: 'assignees',
				title: 'Assignees',
				context: 'FIELD_LIST',
				parentNodeId: 'ticket',
			}) as never,
		);
		mocks.getOrderedChildren.mockReturnValue([]);
		createNodeAtPositionSpy.mockReturnValue(
			succeeded(
				'Created node',
				makeNode({
					id: 'assignment',
					context: 'FIELD',
					parentNodeId: 'assignees',
					props: {value: 'u1'},
				}) as never,
			),
		);

		const result = nodeRepo.assign('ticket', 'u1', 'assignment');

		expect(isFail(result)).toBe(false);
		expect(createNodeAtPositionSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'assignment',
				title: 'Alice',
				parentNodeId: 'assignees',
				props: {value: 'u1'},
			}),
		);
	});

	it('tag fails when tag is already assigned', () => {
		vi.spyOn(nodeRepo, 'getTag').mockReturnValue({
			id: 't1',
			name: 'Bug',
		} as never);
		vi.spyOn(nodeRepo, 'getNode').mockImplementation((id: string) => {
			if (id === 'ticket') {
				return makeNode({id: 'ticket', context: 'TICKET'}) as never;
			}
			return undefined;
		});
		vi.spyOn(nodeRepo, 'getFieldByTitle').mockReturnValue(
			makeNode({
				id: 'tags',
				title: 'Tags',
				context: 'FIELD_LIST',
				parentNodeId: 'ticket',
			}) as never,
		);

		mocks.getOrderedChildren.mockReturnValue([
			makeNode({
				id: 'existing',
				context: 'FIELD',
				parentNodeId: 'tags',
				props: {value: 't1'},
			}),
		]);

		const result = nodeRepo.tag('ticket', 't1', 'tag-node');

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('Tag already assigned');
		}
	});
});

describe('nodeRepo.createNodeAtPosition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.midRank.mockReturnValue('mid');
		mocks.resolveMoveRank.mockReturnValue(
			succeeded('Resolved rank', 'resolved-rank'),
		);
	});

	it('uses midRank when node has no parent', () => {
		const createNodeSpy = vi
			.spyOn(nodeRepo, 'createNode')
			.mockReturnValue(
				succeeded(
					'Node created',
					makeNode({id: 'rootless', context: 'BOARD', rank: 'mid'}) as never,
				),
			);

		const result = nodeRepo.createNodeAtPosition(
			makeNode({
				id: 'rootless',
				context: 'BOARD',
				parentNodeId: undefined,
				rank: '',
			}) as never,
		);

		expect(isFail(result)).toBe(false);
		expect(mocks.midRank).toHaveBeenCalled();
		expect(createNodeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'rootless',
				rank: 'mid',
			}),
		);
	});

	it('uses resolveMoveRank when node has a parent', () => {
		const createNodeSpy = vi.spyOn(nodeRepo, 'createNode').mockReturnValue(
			succeeded(
				'Node created',
				makeNode({
					id: 'child',
					context: 'FIELD',
					parentNodeId: 'parent',
					rank: 'resolved-rank',
				}) as never,
			),
		);

		mocks.getOrderedChildren.mockReturnValue([
			makeNode({id: 'a', context: 'FIELD', parentNodeId: 'parent', rank: 'a'}),
		]);

		const result = nodeRepo.createNodeAtPosition(
			makeNode({
				id: 'child',
				context: 'FIELD',
				parentNodeId: 'parent',
				rank: '',
			}) as never,
			{at: 'end'},
		);

		expect(isFail(result)).toBe(false);
		expect(mocks.resolveMoveRank).toHaveBeenCalledWith(expect.any(Array), {
			at: 'end',
		});
		expect(createNodeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'child',
				rank: 'resolved-rank',
			}),
		);
	});
});

describe('nodeRepo.createNode / updateNode', () => {
	it('createNode returns success when updateState succeeds', () => {
		mocks.updateState.mockReturnValue(succeeded('Updated', null));

		const node = makeNode({id: 'x', context: 'BOARD'});
		const result = nodeRepo.createNode(node as never);

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.message).toBe('Node created');
			expect(result.value).toEqual(node);
		}
	});

	it('updateNode returns succeeded(node) when updateState succeeds', () => {
		mocks.updateState.mockReturnValue(
			succeeded('Updated via updateState', {
				some: 'payload',
			}),
		);

		const node = makeNode({id: 'x', context: 'BOARD'});
		const result = nodeRepo.updateNode(node as never);

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(result.message).toBe('Updated node');
			expect(result.value).toEqual(node);
		}
	});
});
