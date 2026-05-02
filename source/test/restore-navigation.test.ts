import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Mode} from '../lib/model/action-map.model.js';
import {getState, initWorkspaceState, patchState} from '../lib/state/state.js';
import {AnyContext, Workspace} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {
	captureNavigationAnchor,
	restoreNavigationAnchor,
} from '../lib/actions/default/restore-navigation.js';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';

vi.mock('../lib/actions/default/navigation-action-utils.js', () => ({
	navigationUtils: {
		navigate: vi.fn(({currentNode, selectedIndex}) => {
			patchState({
				currentNodeId: currentNode.id,
				selectedIndex,
				mode: Mode.DEFAULT,
			});
		}),
	},
}));

const makeNode = <T extends AnyContext>({
	id,
	parentNodeId,
	context,
	rank,
	title = id,
}: {
	id: string;
	parentNodeId?: string;
	context: T;
	rank: string;
	title?: string;
}): NavNode<T> =>
	({
		id,
		parentNodeId,
		context,
		rank,
		title,
		props: {},
		readonly: false,
		isDeleted: false,
	} as NavNode<T>);

const makeWorkspace = (): Workspace =>
	makeNode({
		id: 'root',
		context: 'WORKSPACE',
		rank: 'a',
		title: 'Workspace',
	}) as Workspace;

const seedState = () => {
	const workspace = makeWorkspace();
	const board = makeNode({
		id: 'board',
		parentNodeId: 'root',
		context: 'BOARD',
		rank: 'a',
	});
	const a = makeNode({
		id: 'a',
		parentNodeId: 'board',
		context: 'TICKET',
		rank: 'a',
	});
	const b = makeNode({
		id: 'b',
		parentNodeId: 'board',
		context: 'TICKET',
		rank: 'b',
	});
	const c = makeNode({
		id: 'c',
		parentNodeId: 'board',
		context: 'TICKET',
		rank: 'c',
	});

	initWorkspaceState(workspace);

	patchState({
		nodes: {
			root: workspace,
			board,
			a,
			b,
			c,
		},
		currentNodeId: 'board',
		selectedIndex: 1,
	});
};

describe('navigation restore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedState();
	});

	it('captures current node id, selected node id, parent id and index', () => {
		expect(captureNavigationAnchor()).toEqual({
			currentNodeId: 'board',
			selectedNodeId: 'b',
			parentNodeId: 'board',
			selectedIndex: 1,
		});
	});

	it('restores exact selected node in same container', () => {
		const result = restoreNavigationAnchor(captureNavigationAnchor());

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'board'}),
			selectedIndex: 1,
		});
	});

	it('restores selected node after it moved to a new parent', () => {
		const anchor = captureNavigationAnchor();

		const other = makeNode({
			id: 'other',
			parentNodeId: 'root',
			context: 'BOARD',
			rank: 'b',
		});

		patchState({
			nodes: {
				...getState().nodes,
				other,
				b: {
					...getState().nodes['b']!,
					parentNodeId: 'other',
					rank: 'a',
				},
			},
		});

		const result = restoreNavigationAnchor(anchor);

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'other'}),
			selectedIndex: 0,
		});
	});

	it('falls back to same container and closest old index when selected node is deleted', () => {
		const anchor = captureNavigationAnchor();

		patchState({
			nodes: {
				...getState().nodes,
				b: {
					...getState().nodes['b']!,
					isDeleted: true,
				},
			},
		});

		const result = restoreNavigationAnchor(anchor);

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'board'}),
			selectedIndex: 1,
		});
	});

	it('clamps old index when same container has fewer children', () => {
		const anchor = {
			currentNodeId: 'board',
			selectedNodeId: 'c',
			parentNodeId: 'board',
			selectedIndex: 2,
		};

		patchState({
			nodes: {
				...getState().nodes,
				b: {...getState().nodes['b']!, isDeleted: true},
				c: {...getState().nodes['c']!, isDeleted: true},
			},
		});

		const result = restoreNavigationAnchor(anchor);

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'board'}),
			selectedIndex: 0,
		});
	});

	it('falls back to old parent when current container is deleted', () => {
		const anchor = {
			currentNodeId: 'deleted-current',
			selectedNodeId: 'missing',
			parentNodeId: 'board',
			selectedIndex: 2,
		};

		const result = restoreNavigationAnchor(anchor);

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'board'}),
			selectedIndex: 2,
		});
	});

	it('falls back to root when previous location no longer exists', () => {
		const anchor = {
			currentNodeId: 'missing-current',
			selectedNodeId: 'missing-selected',
			parentNodeId: 'missing-parent',
			selectedIndex: 5,
		};

		const result = restoreNavigationAnchor(anchor);

		expect(result.status).toBe('success');
		expect(navigationUtils.navigate).toHaveBeenCalledWith({
			currentNode: expect.objectContaining({id: 'root'}),
			selectedIndex: 0,
		});
	});
});
