import fs from 'node:fs';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import WebSocket from 'ws';
import {startGuiServer} from '../../gui/api/api-server.js';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {getGitDir} from '../../git/git-utils.js';
import {SYNC_LOCK_FILE} from '../../git/sync-lock.js';
import {isFail} from '../../lib/model/result-types.js';
import {checkoutStateAt, returnToLive} from '../../mcp/epiq-time-travel.js';
import {commonSteps} from './e2e-common-steps.js';
import {
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	setupTui,
} from './e2e.helper.js';

// A TUI and a GUI server on one worktree, autosync off: each has to see the
// other's writes through its own watch, with no sync to carry them.

const testTimeout = 90_000;

type Tui = ReturnType<typeof setupTui>;
type Frame = {type: string; payload?: unknown};

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(commandLineIsIdle, 5_000);
};

// A socket that keeps every frame, so a test can ask what arrived since a
// point without racing the arrival.
const connect = async (port: number) => {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	const frames: Frame[] = [];

	socket.on('message', raw => frames.push(JSON.parse(raw.toString())));
	await new Promise<void>((resolve, reject) => {
		socket.once('open', () => resolve());
		socket.once('error', reject);
	});

	const statesSince = (mark: number) =>
		frames.slice(mark).filter(frame => frame.type === 'state');

	return {
		socket,
		mark: () => frames.length,
		send: (frame: Frame) => socket.send(JSON.stringify(frame)),
		statesSince,
		// Resolves on the first state after `mark` that mentions `text`.
		waitForState: async (mark: number, text: string, timeoutMs = 8_000) => {
			const deadline = Date.now() + timeoutMs;

			while (Date.now() < deadline) {
				const hit = statesSince(mark).find(frame =>
					JSON.stringify(frame.payload).includes(text),
				);
				if (hit) return hit;

				await new Promise(resolve => setTimeout(resolve, 50));
			}

			throw new Error(`No state mentioning "${text}" within ${timeoutMs}ms`);
		},
	};
};

type Client = Awaited<ReturnType<typeof connect>>;

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The lane's id, found in a state payload rather than assumed.
const findLaneId = (payload: unknown, title: string): string | null => {
	const state = payload as {
		value?: {boards?: {swimlanes?: {id: string; title: string}[]}[]};
	};

	const lane = (state.value?.boards ?? [])
		.flatMap(board => board.swimlanes ?? [])
		.find(swimlane => swimlane.title === title);

	return lane?.id ?? null;
};

let tui: Tui;
let server: {close: () => void};
let port: number;
let repoRoot: string;
let stateBranchRoot: string;
let todoLaneId: string;
const clients: Client[] = [];

beforeAll(async () => {
	tui = setupTui();
	await commonSteps.configureInitialSettings(tui, 'off');
	await commonSteps.init(tui);
	tui.input(ENTER);
	await tui.waitFor('Todo (0)', 20_000);

	repoRoot = tui.cwd;

	const root = getStateBranchRoot({repoRoot});
	if (isFail(root)) throw new Error(root.message);
	stateBranchRoot = root.value;

	const started = await startGuiServer({repoRoot, boardId: ''});
	if (isFail(started)) throw new Error(started.message);
	server = started.value.server;

	const address = started.value.server.address();
	if (!address || typeof address === 'string') throw new Error('No address');
	port = address.port;

	const probe = await connect(port);
	clients.push(probe);
	const mark = probe.mark();
	probe.send({type: 'state:get'});
	const state = await probe.waitForState(mark, 'Todo');

	const laneId = findLaneId(state.payload, 'Todo');
	if (!laneId) throw new Error('No Todo lane in the GUI state');
	todoLaneId = laneId;
}, testTimeout);

afterAll(async () => {
	for (const client of clients) client.socket.close();
	server?.close();
	await tui?.destroy();
});

describe('a live board across a TUI and a GUI, autosync off', () => {
	it(
		'shows a ticket made in the TUI to a GUI client that asked for nothing',
		async () => {
			const client = await connect(port);
			clients.push(client);
			const mark = client.mark();

			await run(tui, ':new issue Made in the TUI', 'new issue Made in');

			await client.waitForState(mark, 'Made in the TUI');
		},
		testTimeout,
	);

	it(
		'shows a ticket made in the GUI to the TUI',
		async () => {
			const client = await connect(port);
			clients.push(client);

			client.send({
				type: 'issues:create',
				payload: {title: 'Made in the GUI', parentId: todoLaneId},
			});

			await tui.waitFor('Made in the GUI', 10_000);
		},
		testTimeout,
	);

	it(
		'shows one GUI client’s change to another',
		async () => {
			const author = await connect(port);
			const watcher = await connect(port);
			clients.push(author, watcher);
			const mark = watcher.mark();

			author.send({
				type: 'issues:create',
				payload: {title: 'From another tab', parentId: todoLaneId},
			});

			await watcher.waitForState(mark, 'From another tab');
		},
		testTimeout,
	);

	it(
		'stays quiet while nothing moves',
		async () => {
			const client = await connect(port);
			clients.push(client);

			// Anything the tests above set moving has landed by now.
			await settle(3_000);
			const mark = client.mark();
			await settle(3_000);

			expect(client.statesSince(mark)).toHaveLength(0);
		},
		testTimeout,
	);

	it(
		'waits out a live sync holding the worktree',
		async () => {
			const client = await connect(port);
			clients.push(client);

			const gitDir = await getGitDir(stateBranchRoot);
			if (isFail(gitDir)) throw new Error(gitDir.message);
			const lockPath = path.join(gitDir.value, SYNC_LOCK_FILE);

			// This process is alive, so the lock counts as held.
			fs.writeFileSync(
				lockPath,
				JSON.stringify({
					pid: process.pid,
					hostname: (await import('node:os')).hostname(),
					startedAt: Date.now(),
					operation: 'sync',
				}),
			);

			try {
				const mark = client.mark();
				await run(tui, ':new issue Behind a lock', 'new issue Behind');

				await settle(3_000);
				expect(
					client
						.statesSince(mark)
						.some(frame =>
							JSON.stringify(frame.payload).includes('Behind a lock'),
						),
				).toBe(false);

				fs.rmSync(lockPath, {force: true});

				await client.waitForState(mark, 'Behind a lock');
			} finally {
				fs.rmSync(lockPath, {force: true});
			}
		},
		testTimeout,
	);

	it(
		'leaves a GUI in the past alone, and catches it up on return',
		async () => {
			const client = await connect(port);
			clients.push(client);

			const checkout = await checkoutStateAt({
				repoRoot,
				targetTime: Date.now() - 60_000,
			});
			expect(isFail(checkout)).toBe(false);

			let backMark = 0;

			try {
				const mark = client.mark();
				await run(tui, ':new issue While in the past', 'new issue While');

				await settle(3_000);
				expect(
					client
						.statesSince(mark)
						.some(frame =>
							JSON.stringify(frame.payload).includes('While in the past'),
						),
				).toBe(false);
			} finally {
				backMark = client.mark();
				const live = await returnToLive({repoRoot});
				expect(isFail(live)).toBe(false);
			}

			// Unasked: the watch publishes what it held back while in the past.
			await client.waitForState(backMark, 'While in the past');
		},
		testTimeout,
	);
});
