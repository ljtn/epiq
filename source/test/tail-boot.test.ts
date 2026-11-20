import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	cachedEntryCount,
	getEdgeRef,
	getPersistFileName,
	materializeAndPersistAll,
	persist,
} from '../lib/board/board-log.js';
import {
	saveSnapshot,
	setTailBoot,
	syncBoardWithLog,
	unreadableInLog,
} from '../lib/board/board-tail.js';
import {setSuffixReplay} from '../lib/board/board-replayed.js';
import {logSignature} from '../lib/event/log-signature.js';
import {flushPendingLogs, getPendingLogPath} from '../lib/event/pending-log.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {getEventsDirPath} from '../lib/storage/paths.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// A process kept current from the log's tail alone must hold exactly the board
// a process reading the whole log from nothing does: through its own writes,
// syncs folding them, teammates, corrupt lines and events it cannot read.

const me = {userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', userName: 'me'};
const THEM = '01ARZ3NDEKTSV4RRFFQ69G5FAW.bob.jsonl';

// The board, without what a tail process keeps no copy of: the app-wide log
// and where each event sits in it.
const digestOf = (state: ReturnType<typeof getState>): string => {
	const sorted = (value: unknown): unknown =>
		value && typeof value === 'object'
			? Array.isArray(value)
				? value.map(sorted)
				: Object.fromEntries(
						Object.keys(value)
							.filter(key => key !== 'logged')
							.sort()
							.map(key => [
								key,
								sorted((value as Record<string, unknown>)[key]),
							]),
				  )
			: value;
	return JSON.stringify(
		sorted({
			nodes: state.nodes,
			comments: state.comments,
			attachments: state.attachments,
			contributors: state.contributors,
			tags: state.tags,
			goals: state.goals,
			authors: state.authors,
			actorsById: state.actorsById,
			children: Object.fromEntries(
				Object.entries(state.renderedChildrenIndex).map(([parent, list]) => [
					parent,
					list.map(node => node.id),
				]),
			),
		}),
	);
};

// A process that has just started, with nothing but the log.
const coldBoot = async (root: string) => {
	vi.resetModules();
	const virtual = await import('../lib/virtual-nodes/virtual-nodes.js');
	virtual.setVirtualNodesEnabled(false);
	const state = await import('../lib/state/state.js');
	const nodeBuilder = await import('../lib/state/node-builder.js');
	const log = await import('../lib/board/board-log.js');
	const boot = await import('../lib/board/board-boot.js');
	unwrap(
		state.initWorkspaceState(nodeBuilder.nodes.workspace('root', 'Root', 'a0')),
	);
	const events = unwrap(log.loadMergedEventsWithUnreadable(root));
	unwrap(boot.bootStateFromEventLog(events.events, events.unreadable));
	return {board: digestOf(state.getState()), unreadable: events.unreadable};
};

let root = '';
beforeAll(() => {
	setVirtualNodesEnabled(false);
	setSuffixReplay(true);
	setTailBoot(true);
});
afterAll(() => {
	setTailBoot(false);
	setSuffixReplay(false);
	fs.rmSync(root, {recursive: true, force: true});
});

describe('a board kept current from the log tail alone', () => {
	it('is the board a full read gives, after every change', async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-tail-boot-'));
		const dir = getEventsDirPath(root);
		const defaults = unwrap(createDefaultEvents(me)) as AppEvent[];
		for (const event of defaults) unwrap(persist({event, rootDir: root}));
		const lanes = defaults
			.filter(event => event.action === 'add.swimlane')
			.map(event => (event.payload as {id: string}).id);

		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', 'a0')));
		const sync = () =>
			unwrap(syncBoardWithLog(root, logSignature(root), () => true));
		expect(sync()).toBe('full');

		const random = seededRandom(7);
		const tickets: string[] = [];
		const seen: string[] = [];
		const modes: string[] = [];
		let n = 0;
		let tick = 0;
		const settle = () => {
			tick++;
			for (const name of fs.readdirSync(dir)) {
				const at = new Date(Date.UTC(2023, 0, 1) + tick * 7);
				fs.utimesSync(path.join(dir, name), at, at);
			}
		};

		for (let step = 0; step < 120; step++) {
			const roll = random(12);
			const ticket = tickets[random(tickets.length)];

			if (roll < 4 || tickets.length === 0) {
				// Own writes, through the real write path.
				const event = (
					!ticket || random(3) === 0
						? {
								id: ulid(),
								action: 'add.issue',
								payload: {
									id: ulid(),
									name: `T${n++}`,
									parent: lanes[random(lanes.length)]!,
									rank: rank(),
								},
								userId: me.userId,
						  }
						: random(2) === 0
						? {
								id: ulid(),
								action: 'move.node',
								payload: {
									id: ticket,
									parent: lanes[random(lanes.length)]!,
									rank: rank(),
								},
								userId: me.userId,
						  }
						: {
								id: ulid(),
								action: 'add.issue.comment',
								payload: {
									id: ulid(),
									issue: ticket,
									author: me.userId,
									md: `c${n++}`,
								},
								userId: me.userId,
						  }
				) as AppEvent;
				const results = materializeAndPersistAll([event], root);
				if (!isFail(results) && event.action === 'add.issue') {
					tickets.push((event.payload as {id: string}).id);
				}
			} else if (roll < 6) {
				flushPendingLogs(root, getPersistFileName(me));
			} else {
				// A teammate, who has seen what we have or a little less.
				const edge = unwrap(getEdgeRef(root));
				const parent =
					random(4) === 0 && seen.length > 0
						? seen[Math.max(0, seen.length - 1 - random(4))]!
						: edge;
				const id = ulid();
				const kind = random(10);
				const line =
					kind === 0
						? '{"broken\n'
						: `${JSON.stringify({
								v: 1,
								id: [id, parent],
								...(kind === 1
									? {'future.action': {id: ticket ?? 'x'}}
									: {
											'edit.title': {
												id: ticket ?? lanes[0],
												name: `bob ${n++}`,
											},
									  }),
						  })}\n`;
				fs.appendFileSync(path.join(dir, THEM), line);
				seen.push(id);
			}
			settle();

			modes.push(sync());
			const cold = await coldBoot(root);
			expect(digestOf(getState()), `step ${step}`).toBe(cold.board);
			expect(unreadableInLog(), `step ${step}`).toEqual(cold.unreadable);
			// No event kept by the process that keeps the board.
			expect(getState().eventLog).toEqual([]);
			expect(cachedEntryCount(), `step ${step}`).toBe(0);
		}

		// A full boot every time would pass all of the above and prove nothing:
		// own writes and syncs must keep the tail, the first boot aside.
		expect(modes.filter(mode => mode === 'full').length).toBeLessThanOrEqual(3);
	}, 120_000);
});

describe('a write applied and then lost', () => {
	it('leaves no tail to boot from, and nothing to save, until a full boot', async () => {
		const lost = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-tail-lost-'));
		try {
			const dir = getEventsDirPath(lost);
			const defaults = unwrap(createDefaultEvents(me)) as AppEvent[];
			for (const event of defaults) unwrap(persist({event, rootDir: lost}));
			const lane = defaults.find(event => event.action === 'add.swimlane')!
				.payload as {id: string};
			const settle = (at: number) => {
				for (const name of fs.readdirSync(dir)) {
					fs.utimesSync(path.join(dir, name), new Date(at), new Date(at));
				}
			};
			const sync = () =>
				unwrap(syncBoardWithLog(lost, logSignature(lost), () => true));

			vi.stubEnv('EPIQ_SNAPSHOT', '1');
			unwrap(initWorkspaceState(nodes.workspace('root', 'Root', 'a0')));
			settle(Date.UTC(2023, 0, 1));
			expect(sync()).toBe('full');
			expect(saveSnapshot(lost)).toBe(true);

			// The log cannot take the line: applied, never written.
			const pending = getPendingLogPath(lost, getPersistFileName(me));
			fs.chmodSync(pending, 0o444);
			const results = materializeAndPersistAll(
				[
					{
						id: ulid(),
						action: 'add.issue',
						payload: {id: ulid(), name: 'Lost', parent: lane.id, rank: rank()},
						userId: me.userId,
					} as AppEvent,
				],
				lost,
			);
			fs.chmodSync(pending, 0o644);
			expect(isFail(results)).toBe(true);

			expect(saveSnapshot(lost)).toBe(false);
			settle(Date.UTC(2023, 0, 2));
			expect(sync()).toBe('full');
			expect(digestOf(getState())).toBe((await coldBoot(lost)).board);
		} finally {
			vi.unstubAllEnvs();
			fs.rmSync(lost, {recursive: true, force: true});
		}
	});
});
