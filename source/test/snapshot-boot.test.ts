import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	getEdgeRef,
	getPersistFileName,
	materializeAndPersistAll,
	persist,
} from '../lib/board/board-log.js';
import {
	saveSnapshot,
	setTailBoot,
	syncBoardWithLog,
} from '../lib/board/board-tail.js';
import {logSignature} from '../lib/event/log-signature.js';
import {flushPendingLogs} from '../lib/event/pending-log.js';
import {getGlobalConfigDir} from '../lib/storage/global-config-dir.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {getEventsDirPath} from '../lib/storage/paths.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {rank, unwrap} from './helpers/random-board-log.js';
import {seededRandom} from './helpers/seeded-random.js';

// A process started from a snapshot must hold the board a full read gives,
// whatever the log did after the snapshot was saved, and start in full
// wherever the snapshot cannot vouch for itself.

const me = {userId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', userName: 'me'};
const THEM = '01ARZ3NDEKTSV4RRFFQ69G5FAW.bob.jsonl';

type State = ReturnType<typeof getState>;

// The board, without what a tail process keeps no copy of.
const digestOf = (state: State): string => {
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

// A process that has just started with nothing but the log.
const coldDigest = async (root: string): Promise<string> => {
	vi.resetModules();
	(
		await import('../lib/virtual-nodes/virtual-nodes.js')
	).setVirtualNodesEnabled(false);
	const state = await import('../lib/state/state.js');
	const builder = await import('../lib/state/node-builder.js');
	const log = await import('../lib/board/board-log.js');
	const boot = await import('../lib/board/board-boot.js');
	unwrap(
		state.initWorkspaceState(builder.nodes.workspace('root', 'Root', 'a0')),
	);
	const events = unwrap(log.loadMergedEventsWithUnreadable(root));
	unwrap(boot.bootStateFromEventLog(events.events, events.unreadable));
	return digestOf(state.getState());
};

// A process that has just started in tail mode: how it booted, and its board.
const freshTailProcess = async (root: string) => {
	vi.resetModules();
	(
		await import('../lib/virtual-nodes/virtual-nodes.js')
	).setVirtualNodesEnabled(false);
	const tail = await import('../lib/board/board-tail.js');
	const signature = await import('../lib/event/log-signature.js');
	const state = await import('../lib/state/state.js');
	const log = await import('../lib/board/board-log.js');
	tail.setTailBoot(true);
	const mode = unwrap(
		tail.syncBoardWithLog(root, signature.logSignature(root), () => true),
	);
	const digest = digestOf(state.getState());
	const held = log.cachedEntryCount();
	tail.setTailBoot(false);
	return {mode, digest, held};
};

let root = '';
beforeAll(() => {
	vi.stubEnv('EPIQ_SNAPSHOT', '1');
	setVirtualNodesEnabled(false);
	setTailBoot(true);
});
afterAll(() => {
	setTailBoot(false);
	vi.unstubAllEnvs();
	fs.rmSync(root, {recursive: true, force: true});
});

describe('a process started from a snapshot', () => {
	it('holds what a full read does, and starts in full when it must', async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-snapshot-boot-'));
		const dir = getEventsDirPath(root);
		const defaults = unwrap(createDefaultEvents(me)) as AppEvent[];
		for (const event of defaults) unwrap(persist({event, rootDir: root}));
		const lanes = defaults
			.filter(event => event.action === 'add.swimlane')
			.map(event => (event.payload as {id: string}).id);

		let tick = 0;
		const settle = () => {
			tick++;
			for (const name of fs.readdirSync(dir)) {
				const at = new Date(Date.UTC(2023, 0, 1) + tick * 7);
				fs.utimesSync(path.join(dir, name), at, at);
			}
		};

		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', 'a0')));
		const sync = () =>
			unwrap(syncBoardWithLog(root, logSignature(root), () => true));
		settle();
		expect(sync()).toBe('full');

		const random = seededRandom(11);
		const tickets: string[] = [];
		const modes: string[] = [];
		const snapshots = () =>
			fs.readdirSync(path.join(getGlobalConfigDir(), 'snapshots'));

		for (let round = 0; round < 25; round++) {
			// This process saves, now and then.
			if (random(2) === 0) expect(saveSnapshot(root)).toBe(true);

			// The log moves on after the save.
			for (let step = 0; step < 1 + random(4); step++) {
				const roll = random(10);
				if (roll < 4) {
					const event = {
						id: ulid(),
						action: 'add.issue',
						payload: {
							id: ulid(),
							name: `T${round}.${step}`,
							parent: lanes[random(lanes.length)]!,
							rank: rank(),
						},
						userId: me.userId,
					} as AppEvent;
					unwrap(materializeAndPersistAll([event], root));
					tickets.push((event.payload as {id: string}).id);
				} else if (roll < 6) {
					flushPendingLogs(root, getPersistFileName(me));
				} else {
					fs.appendFileSync(
						path.join(dir, THEM),
						random(8) === 0
							? '{"broken\n'
							: `${JSON.stringify({
									v: 1,
									id: [ulid(), unwrap(getEdgeRef(root))],
									'edit.title': {
										id: tickets[random(tickets.length)] ?? lanes[0],
										name: `bob ${round}.${step}`,
									},
							  })}\n`,
					);
				}
			}

			// What a snapshot cannot vouch for: a rewritten prefix, damage, a key
			// it was not written under.
			const damage = random(8);
			if (damage === 0 && fs.existsSync(path.join(dir, THEM))) {
				const file = path.join(dir, THEM);
				fs.writeFileSync(
					file,
					fs.readFileSync(file, 'utf8').replace('bob', 'rob'),
				);
			} else if (damage === 1 && snapshots().length > 0) {
				const file = path.join(
					getGlobalConfigDir(),
					'snapshots',
					snapshots()[0]!,
				);
				const bytes = fs.readFileSync(file);
				fs.writeFileSync(file, bytes.subarray(0, bytes.length >> 1));
			}
			settle();
			sync();

			const fresh = await freshTailProcess(root);
			modes.push(fresh.mode);
			expect(fresh.digest, `round ${round}`).toBe(await coldDigest(root));
			expect(fresh.held, `round ${round}`).toBe(0);
		}

		// Starting in full every time would pass all of the above and prove nothing.
		expect(modes.filter(mode => mode === 'snapshot').length).toBeGreaterThan(8);
		expect(modes).toContain('full');
	}, 180_000);
});
