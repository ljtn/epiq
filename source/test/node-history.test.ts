import {ulid} from 'ulid';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	forgetCheckpoints,
	materializeCut,
} from '../lib/board/board-checkpoints.js';
import {
	enteredLaneAt,
	foldHistory,
	lastEventAt,
	parentsEver,
	visitsOf,
} from '../lib/board/node-history.js';
import {
	materialize,
	materializeAll,
	type ReconstructedEvent,
} from '../lib/board/board-log.js';
import {MAX_ULID_AHEAD_MS} from '../lib/event/date-utils.js';
import {succeeded} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	getState,
	initWorkspaceState,
	nodeIdsOf,
	nodeIdsWithRef,
	entryIdsOfIssue,
} from '../lib/state/state.js';
import {nodeRef} from '../lib/utils/node-ref.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {
	laneEntryTime,
	laneVisits,
	lastEventTime,
	reopenParentFromLog,
} from './helpers/log-reference.js';
import {getAffectedNodeIds} from '../lib/board/board-replay.js';
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
		// Several authors, so who touched what is not everyone, everywhere.
		return {...event, id, userId: `u${random(3)}`};
	});
};

// A node's log as the app-wide one holds it: every applied event that affects
// it, in order. Exact for a ticket, which is never another node's parent; a
// lane's would also need its children's parents as they were.
// An add of a node that exists builds it afresh, so its log starts at the last.
const CREATES = new Set([
	'init.workspace',
	'add.workspace',
	'add.board',
	'add.swimlane',
	'add.issue',
	'add.field',
]);

const referenceLog = (nodeId: string): Array<[number, AppEvent]> => {
	const located = getState()
		.eventLog.map((event, position): [number, AppEvent] => [position, event])
		.filter(([, event]) => getAffectedNodeIds(event).includes(nodeId));
	const created = located.findLastIndex(
		([, event]) =>
			CREATES.has(event.action) &&
			(event.payload as {id?: string}).id === nodeId,
	);
	return located.slice(Math.max(created, 0));
};

// Now and then, before a ticket is filed, an event naming it already: forged,
// or out of causal order. It must count for that ticket as the old scan did.
const forgeEarly = (seed: number, log: AppEvent[]): AppEvent[] => {
	const random = seededRandom(seed * 5 + 3);
	return log.flatMap(event => {
		if (event.action !== 'add.issue' || random(4) !== 0) return [event];
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
			{action: 'add.issue.tag', payload: {id: ticket, tag: 'early-tag'}},
		][random(3)]!;
		return [
			{...early, id: `${event.id}x`, userId: `u${random(3)}`} as AppEvent,
			event,
		];
	});
};

// The rule `ticket-boards` read a log by: any event naming the node and a parent.
const parentsFromLog = (
	nodeId: string,
	current: string | null,
	log: readonly AppEvent[],
): string[] => {
	const parents = new Set<string>();
	if (current) parents.add(current);
	for (const entry of log) {
		const payload = entry.payload as {id?: string; parent?: string};
		if (payload.id === nodeId && payload.parent) parents.add(payload.parent);
	}
	return [...parents];
};

// Who wrote what, as the scans over the whole log found it.
const expectActorsEqualLog = () => {
	const {eventLog, actorsById, authors} = getState();
	const byId = new Map<string, string[]>();
	const everyone: string[] = [];
	// A genesis applied mid-batch resets the board, yet the batch's earlier
	// events still reach the log: who wrote those is the old board's.
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
	// Only tickets are asked about: for each, the old scan's answer.
	const tickets = Object.values(getState().nodes)
		.filter(node => node.context === 'TICKET')
		.map(node => node.id);
	for (const id of tickets) {
		expect(actorsById?.[id]?.ids ?? [], id).toEqual(byId.get(id) ?? []);
	}
	for (const id of Object.keys(actorsById ?? {})) {
		expect(tickets, id).toContain(id);
	}
	expect(Object.keys(authors ?? {}).sort()).toEqual([...everyone].sort());
};

// Each kind's ids, as a scan of the node map finds them, in its order.
const expectKindsEqualScan = () => {
	const all = Object.values(getState().nodes);
	for (const context of new Set(all.map(node => node.context))) {
		expect([...nodeIdsOf(context)], context).toEqual(
			all.filter(node => node.context === context).map(node => node.id),
		);
	}
	// Comments and attachments by their ticket, as a scan finds them.
	for (const key of ['comments', 'attachments'] as const) {
		const entries = Object.entries(getState()[key] ?? {});
		for (const issue of new Set(entries.map(([, entry]) => entry.issue))) {
			expect([...entryIdsOfIssue(key, issue)], `${key} ${issue}`).toEqual(
				entries.filter(([, entry]) => entry.issue === issue).map(([id]) => id),
			);
		}
	}
	for (const ref of new Set(all.map(node => nodeRef(node.id)))) {
		expect([...nodeIdsWithRef(ref)], ref).toEqual(
			all.filter(node => nodeRef(node.id) === ref).map(node => node.id),
		);
	}
};

const expectFoldedEqualsLog = () => {
	expectActorsEqualLog();
	expectKindsEqualScan();
	for (const node of Object.values(getState().nodes)) {
		const {history} = node;
		const where = node.id;
		const located = referenceLog(node.id);
		const log = located.map(([, event]) => event);

		expect(parentsEver(history, node.parentNodeId), where).toEqual(
			parentsFromLog(node.id, node.parentNodeId, log),
		);
		if (node.context !== 'TICKET') {
			expect(history?.logged ?? [], where).toEqual([]);
			continue;
		}

		const createdAt = T0 - 5;
		expect(history?.logged ?? [], where).toEqual(
			located.map(([position]) => position),
		);
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
			reopenParentFromLog(node.id, log),
		);
	}
};

const asEntries = (events: AppEvent[]): ReconstructedEvent[] =>
	events.map(
		(event, index) =>
			({
				v: 1,
				id: index === 0 ? [event.id] : [event.id, events[index - 1]!.id],
				[event.action]: event.payload,
				userId: event.userId,
				userName: 'one',
			} as unknown as ReconstructedEvent),
	);

beforeAll(() => setVirtualNodesEnabled(false));
afterEach(() => {
	vi.useRealTimers();
	forgetCheckpoints();
});

describe('a node history folded as events apply', () => {
	it('answers as its log does, over any batching', () => {
		for (let seed = 1; seed <= 30; seed++) {
			vi.useFakeTimers({toFake: ['Date']});
			vi.setSystemTime(T0 + 10 * 864e5);
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));

			const log = forgeEarly(seed, timed(seed, randomLog(seed, 150)));
			const random = seededRandom(seed);
			for (let at = 0; at < log.length; ) {
				const next = Math.min(log.length, at + 1 + random(15));
				// One at a time outside a batch, or several in one.
				// Now and then applied without logging, which no log or history keeps.
				if (next - at === 1) materialize(log[at]!, random(5) === 0);
				else materializeAll(log.slice(at, next));
				at = next;
				// Read each time, so a later write finds it built.
				expectKindsEqualScan();
			}

			// Read later than folded: times once ahead of the clock may be honest now.
			vi.setSystemTime(T0 + 13 * 864e5);
			expectFoldedEqualsLog();
		}
	});

	it('keeps nothing of an event applied without logging', () => {
		for (let seed = 1; seed <= 10; seed++) {
			vi.useFakeTimers({toFake: ['Date']});
			vi.setSystemTime(T0 + 10 * 864e5);
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
			const random = seededRandom(seed * 7);
			for (const event of timed(seed, randomLog(seed, 120))) {
				materialize(event, random(2) === 0);
			}
			expectFoldedEqualsLog();
		}
	});

	it('answers as its log does after a checkpoint is restored', () => {
		// One clock for both sides: a far-future time reads as now.
		vi.useFakeTimers({toFake: ['Date']});
		vi.setSystemTime(T0 + 10 * 864e5);
		for (let seed = 1; seed <= 8; seed++) {
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
			const entries = asEntries(timed(seed, randomLog(seed, 120)));
			const load = () => succeeded('', entries);

			for (const cut of [T0 + 60 * 60_000, null, T0 + 20 * 60_000, null]) {
				unwrap(materializeCut(`h-${seed}`, load, cut, {budget: 6, minGap: 4}));
				expectFoldedEqualsLog();
			}
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
