import {beforeEach, describe, expect, it} from 'vitest';

import {isFail} from '../lib/model/result-types.js';
import {
	attachLineNodes,
	detachLineNodes,
} from '../lib/repository/line-nodes.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {getOrderedChildren} from '../lib/repository/rank.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

const ROOT = '01H00000000000000000000000';
const PARENT = '01H00000000000000000000002';

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

beforeEach(() => {
	initWorkspaceState(nodes.workspace(ROOT, 'Root', rank()));

	nodeRepo.createNode(
		nodes.field({
			id: PARENT,
			name: 'Diff',
			parentNodeId: ROOT,
			rank: rank(),
			childRenderAxis: 'vertical',
		}),
	);
});

const idFor = (index: number) => `${PARENT}::line::${index}`;

describe('the nodes a long read is navigated by', () => {
	// By id: text nodes don't carry their content, since every `props.value`
	// feeds the autocomplete corpus.
	it('are one per line, in the order the lines came in', () => {
		attachLineNodes(PARENT, 3, idFor);

		expect(getOrderedChildren(PARENT).map(child => child.id)).toEqual([
			idFor(0),
			idFor(1),
			idFor(2),
		]);
	});

	it('are all taken down together', () => {
		const created = attachLineNodes(PARENT, 3, idFor);
		detachLineNodes(created);

		expect(getOrderedChildren(PARENT)).toHaveLength(0);
	});

	it('leave anything that is not theirs alone', () => {
		const other = '01H00000000000000000000009';
		nodeRepo.createNode(
			nodes.field({id: other, name: 'Other', parentNodeId: ROOT, rank: rank()}),
		);

		detachLineNodes(attachLineNodes(PARENT, 2, idFor));

		expect(nodeRepo.getNode(other)).toBeDefined();
		expect(nodeRepo.getNode(PARENT)).toBeDefined();
	});

	/** A loose budget guarding against a quadratic build or teardown, not a benchmark. */
	it('do not cost more than linear to build and tear down', () => {
		const started = performance.now();
		detachLineNodes(attachLineNodes(PARENT, 2000, idFor));
		const elapsed = performance.now() - started;

		expect(getOrderedChildren(PARENT)).toHaveLength(0);
		expect(elapsed).toBeLessThan(1_000);
	});
});
