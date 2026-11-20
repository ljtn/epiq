import {ulid} from 'ulid';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {resolveReopenParentFromLog} from '../lib/board/log-utils.js';
import {
	enteredLaneAt,
	foldHistory,
	loggedEvents,
	lastEventAt,
	parentsEver,
	visitsOf,
} from '../lib/board/node-history.js';
import {materialize, materializeAll} from '../lib/board/board-log.js';
import {MAX_ULID_AHEAD_MS} from '../lib/event/date-utils.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {AnyContext} from '../lib/model/context.model.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {
	laneEntryTime,
	laneVisits,
	lastEventTime,
} from '../lib/utils/lane-dwell.js';
import {randomLog, rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// Every answer a node's log gave, now folded as events apply, must equal the
// log's: after any batching, and after a checkpoint is restored.

const T0 = Date.UTC(2024, 0, 1);

// The generator's ids share one time: give each event its own, now and then
// one ahead of the clock, far in the future, or with no time at all.
const timed = (seed: number, log: AppEvent[]): AppEvent[] => {
	const random = seededRandom(seed * 3 + 1);
	const ids = new Map<string, string>();
	return log.map((event, index) => {
		let id = ids.get(event.id);
		if (!id) {
			const roll = random(30);
			id =
				roll === 0
					? `U${String(index).padStart(25, 'U')}`
					: roll === 1
					? ulid(Date.UTC(2099, 0, 1))
					: roll === 2
					? ulid(T0 + 10 * 864e5 + MAX_ULID_AHEAD_MS + random(5) * 864e5)
					: ulid(T0 + index * 60_000);
			ids.set(event.id, id);
		}
		return {...event, id};
	});
};

// The rule `ticket-boards` reads a log by: any event naming the node and a parent.
const parentsFromLog = (node: NavNode<AnyContext>): string[] => {
	const parents = new Set<string>();
	if (node.parentNodeId) parents.add(node.parentNodeId);
	for (const entry of node.log ?? []) {
		const payload = entry.payload as {id?: string; parent?: string};
		if (payload.id === node.id && payload.parent) parents.add(payload.parent);
	}
	return [...parents];
};

const expectFoldedEqualsLog = () => {
	for (const node of Object.values(getState().nodes)) {
		const log = node.log ?? [];
		const createdAt = T0 - 5;
		const {history} = node;
		const where = node.id;

		expect(visitsOf(history, createdAt), where).toEqual(
			laneVisits(log, createdAt),
		);
		expect(enteredLaneAt(history, createdAt), where).toBe(
			laneEntryTime(log, createdAt),
		);
		expect(lastEventAt(history, createdAt), where).toBe(
			lastEventTime(log, createdAt),
		);
		expect(history?.lastCloseId ?? null, where).toBe(
			log.findLast(event => event.action === 'close.issue')?.id ?? null,
		);
		expect(history?.reopenParent ?? null, where).toBe(
			resolveReopenParentFromLog(node as NavNode<'TICKET'>),
		);
		expect(parentsEver(history, node.parentNodeId), where).toEqual(
			parentsFromLog(node),
		);
		// The same objects, in the same order: the log, without a copy of it.
		if (node.context === 'TICKET') {
			const found = loggedEvents(history, getState().eventLog);
			expect(found.length, where).toBe(log.length);
			found.forEach((event, index) => expect(event, where).toBe(log[index]));
		} else {
			expect(history?.logged ?? [], where).toEqual([]);
		}
	}
};

beforeAll(() => setVirtualNodesEnabled(false));
afterEach(() => {
	vi.useRealTimers();
});

describe('a node history folded as events apply', () => {
	it('answers as its log does, over any batching', () => {
		for (let seed = 1; seed <= 30; seed++) {
			vi.useFakeTimers({toFake: ['Date']});
			vi.setSystemTime(T0 + 10 * 864e5);
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));

			const log = timed(seed, randomLog(seed, 150));
			const random = seededRandom(seed);
			for (let at = 0; at < log.length; ) {
				const next = Math.min(log.length, at + 1 + random(15));
				// One at a time outside a batch, or several in one.
				if (next - at === 1) materialize(log[at]!);
				else materializeAll(log.slice(at, next));
				at = next;
			}

			// Read later than folded: times once ahead of the clock may be honest now.
			vi.setSystemTime(T0 + 13 * 864e5);
			expectFoldedEqualsLog();
		}
	});
});

describe('folding onto a history', () => {
	it('never writes into the history it starts from', () => {
		const log = timed(5, randomLog(5, 200));
		const ticket = log.find(event => event.action === 'add.issue')!.payload as {
			id: string;
		};
		const events = log.filter(
			event => (event.payload as {id?: string}).id === ticket.id,
		);
		let history = foldHistory(undefined, ticket.id, events.slice(0, 1));
		for (const event of events.slice(1)) {
			const before = structuredClone(history);
			const frozen = deepFreeze(history);
			history = foldHistory(frozen, ticket.id, [event]);
			expect(frozen).toEqual(before);
		}
	});
});

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === 'object') {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
};
