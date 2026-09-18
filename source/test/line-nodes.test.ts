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
	// By id rather than by content: a text node deliberately does not carry
	// what it displays, because every node's `props.value` is swept into the
	// command line's autocomplete corpus. The caller renders from its own list
	// and uses these only to put the cursor somewhere.
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

	/**
	 * Both halves used to be quadratic: creating derived the whole board per
	 * node, and deleting copied the whole node map per node. Opening a
	 * 4000-line diff cost 2.3s and leaving it 3.1s, which is a frozen TUI.
	 *
	 * The budget is deliberately loose — this is a guard against the quadratic
	 * shape coming back, not a benchmark. The measured cost after the fix is
	 * single-digit milliseconds; before it, 2000 lines took ~1.8s.
	 */
	it('do not cost more than linear to build and tear down', () => {
		const started = performance.now();
		detachLineNodes(attachLineNodes(PARENT, 2000, idFor));
		const elapsed = performance.now() - started;

		expect(getOrderedChildren(PARENT)).toHaveLength(0);
		expect(elapsed).toBeLessThan(1_000);
	});
});
