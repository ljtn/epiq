import {beforeAll, describe, expect, it} from 'vitest';
import {materialize, materializeAll} from '../lib/board/board-log.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	entryIdsOfIssue,
	getState,
	initWorkspaceState,
	nodeIdsOf,
	nodeIdsWithRef,
	patchState,
} from '../lib/state/state.js';
import {nodeRef} from '../lib/utils/node-ref.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {randomLog, rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// The indexes kept beside the state answer as a scan of it does, in its order:
// after a write alone, in a batch, unlogged, and when a map is replaced whole.

const expectIndexesEqualScan = (where: string) => {
	const all = Object.values(getState().nodes);
	for (const context of new Set(all.map(node => node.context))) {
		expect([...nodeIdsOf(context)], `${where} ${context}`).toEqual(
			all.filter(node => node.context === context).map(node => node.id),
		);
	}
	for (const ref of new Set(all.map(node => nodeRef(node.id)))) {
		expect([...nodeIdsWithRef(ref)], `${where} ${ref}`).toEqual(
			all.filter(node => nodeRef(node.id) === ref).map(node => node.id),
		);
	}
	for (const key of ['comments', 'attachments'] as const) {
		const entries = Object.entries(getState()[key] ?? {});
		for (const issue of new Set(entries.map(([, entry]) => entry.issue))) {
			expect([...entryIdsOfIssue(key, issue)], `${where} ${key}`).toEqual(
				entries.filter(([, entry]) => entry.issue === issue).map(([id]) => id),
			);
		}
	}
};

beforeAll(() => setVirtualNodesEnabled(false));

describe('the indexes beside the state', () => {
	it('answer as a scan of it does, after every kind of write', () => {
		for (let seed = 1; seed <= 30; seed++) {
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
			const log = randomLog(seed, 150);
			const random = seededRandom(seed * 7 + 3);

			for (let at = 0; at < log.length; ) {
				const next = Math.min(log.length, at + 1 + random(12));
				const roll = random(10);
				// One at a time, sometimes unlogged; or several in one batch.
				if (next - at === 1) materialize(log[at]!, roll === 0);
				else materializeAll(log.slice(at, next));
				at = next;

				// A map replaced whole, as a reset or a restore does.
				if (roll === 1) patchState({nodes: {...getState().nodes}});
				if (roll === 2) {
					patchState({comments: {...getState().comments}});
				}
				// A comment's id added again under another ticket, as a duplicated
				// or forged line can: the store takes the later one.
				const comments = Object.keys(getState().comments);
				const tickets = Object.values(getState().nodes)
					.filter(node => node.context === 'TICKET' && !node.isDeleted)
					.map(node => node.id);
				if (roll === 3 && comments.length > 0 && tickets.length > 1) {
					materialize({
						id: `01J${String(seed).padStart(4, '0')}9${String(at).padStart(
							18,
							'0',
						)}`,
						action: 'add.issue.comment',
						payload: {
							id: comments[random(comments.length)]!,
							issue: tickets[random(tickets.length)]!,
							author: 'u1',
							md: 'again',
						},
						userId: 'u1',
					} as never);
				}

				// Read now and then, so later writes find them built.
				if (random(2) === 0) expectIndexesEqualScan(`seed ${seed}`);
			}
			expectIndexesEqualScan(`seed ${seed} end`);
		}
	});
});
