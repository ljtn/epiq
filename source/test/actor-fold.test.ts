import {beforeAll, describe, expect, it} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materialize, materializeAll} from '../lib/board/board-log.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {randomLog, rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// Who wrote what, folded as events apply, answers as a scan of the log did:
// for every ticket, and for the list of everyone who wrote at all.

// Several authors, and now and then an event naming a ticket before the event
// that files it: forged, or out of causal order.
const adversarial = (seed: number, log: AppEvent[]): AppEvent[] => {
	const random = seededRandom(seed * 5 + 3);
	return log.flatMap(event => {
		const authored = {...event, userId: `u${random(3)}`} as AppEvent;
		if (event.action !== 'add.issue' || random(4) !== 0) return [authored];
		const ticket = (event.payload as {id: string}).id;
		const early = [
			{action: 'edit.title', payload: {id: ticket, name: 'early'}},
			{
				action: 'add.issue.comment',
				payload: {
					id: `early-${ticket}`,
					issue: ticket,
					author: 'u2',
					md: 'early',
				},
			},
		][random(2)]!;
		return [
			{...early, id: `${event.id}x`, userId: `u${random(3)}`} as AppEvent,
			authored,
		];
	});
};

const expectFoldEqualsScan = (where: string) => {
	const {eventLog, actorsById, authors} = getState();
	const byId = new Map<string, string[]>();
	const everyone: string[] = [];
	// A genesis applied in a later batch resets the board; that batch's
	// earlier events still reach the log, but belong to the board before it.
	const genesis = eventLog.findLastIndex(e => e.action === 'init.workspace');
	for (const event of eventLog.slice(Math.max(genesis, 0))) {
		if (!event.userId) continue;
		if (!everyone.includes(event.userId)) everyone.push(event.userId);
		const payload = event.payload as {id?: unknown; issue?: unknown};
		for (const target of [payload.id, payload.issue]) {
			if (typeof target !== 'string') continue;
			const ids = byId.get(target) ?? [];
			if (!ids.includes(event.userId)) ids.push(event.userId);
			byId.set(target, ids);
		}
	}
	const tickets = Object.values(getState().nodes)
		.filter(node => node.context === 'TICKET')
		.map(node => node.id);
	for (const id of tickets) {
		expect(actorsById?.[id]?.ids ?? [], `${where} ${id}`).toEqual(
			byId.get(id) ?? [],
		);
	}
	for (const id of Object.keys(actorsById ?? {})) {
		expect(tickets, `${where} ${id}`).toContain(id);
	}
	expect(Object.keys(authors ?? {}).sort(), where).toEqual(
		[...everyone].sort(),
	);
};

beforeAll(() => setVirtualNodesEnabled(false));

describe('who wrote what, folded', () => {
	it('answers as a scan of the log, over any batching and unlogged events', () => {
		for (let seed = 1; seed <= 30; seed++) {
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
			const log = adversarial(seed, randomLog(seed, 150));
			const random = seededRandom(seed);
			for (let at = 0; at < log.length; ) {
				const next = Math.min(log.length, at + 1 + random(12));
				// Alone, sometimes unlogged; or several in one batch.
				if (next - at === 1) materialize(log[at]!, random(3) === 0);
				else materializeAll(log.slice(at, next));
				at = next;
			}
			expectFoldEqualsScan(`seed ${seed}`);
		}
	});
});
