import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AnyContext} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {isFail, succeeded} from '../lib/model/result-types.js';
import {rankBetween} from '../lib/utils/rank.js';

const materializeAndPersistAll = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
	nodes: {} as Record<string, Partial<NavNode<AnyContext>>>,
}));

vi.mock('../lib/state/state.js', () => ({
	getState: () => state,
}));

vi.mock('../lib/event/create-rebalance-children-event.js', () => ({
	createRebalanceChildrenEvent: vi.fn(() =>
		succeeded('Created rebalance event', {
			action: 'rebalance.children',
			payload: {
				parentId: 'parent',
			},
		}),
	),
}));

vi.mock('../lib/event/event-materialize-and-persist.js', () => ({
	materializeAndPersistAll,
}));

describe('resolveAndPersistRankForMove', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.nodes = {};
	});

	it('rebalances exhausted sibling ranks and retries rank resolution', async () => {
		const left = '000000000000000000000001';
		const right = '000000000000000000000002';
		const stateBranchRoot = '/state';

		expect(isFail(rankBetween(left, right))).toBe(true);

		state.nodes = {
			child1: {
				id: 'child1',
				parentNodeId: 'parent',
				rank: left,
				isDeleted: false,
			},
			child2: {
				id: 'child2',
				parentNodeId: 'parent',
				rank: right,
				isDeleted: false,
			},
			moving: {
				id: 'moving',
				parentNodeId: 'other-parent',
				rank: '800000000000000000000000',
				isDeleted: false,
			},
		};

		materializeAndPersistAll.mockImplementation(() => {
			state.nodes['child1']!.rank = '400000000000000000000000';
			state.nodes['child2']!.rank = '800000000000000000000000';

			return succeeded('Persisted rebalance event', [
				{
					action: 'rebalance.children',
					result: {parent: 'parent'},
				},
			]);
		});

		const {resolveAndPersistRankForMove} = await import(
			'../lib/repository/rank.js'
		);

		const result = resolveAndPersistRankForMove(
			'parent',
			'moving',
			{at: 'before', sibling: 'child2'},
			{
				userId: 'user-1',
				userName: 'Test User',
			},
			stateBranchRoot,
		);

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) {
			expect(
				result.value.localeCompare(state.nodes['child1']!.rank ?? ''),
			).toBeGreaterThan(0);
			expect(
				result.value.localeCompare(state.nodes['child2']!.rank ?? ''),
			).toBeLessThan(0);
		}

		expect(materializeAndPersistAll).toHaveBeenCalledTimes(1);
		expect(materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'rebalance.children',
				}),
			],
			stateBranchRoot,
		);
	});
});

describe('rankBetween', () => {
	it('fails when there is no rank space between adjacent ranks', () => {
		const result = rankBetween(
			'000000000000000000000001',
			'000000000000000000000002',
		);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toBe('No rank space available between neighbors');
		}
	});
});
