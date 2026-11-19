import http from 'node:http';
import {AddressInfo} from 'node:net';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebSocket} from 'ws';

// Every imported entry point must exist on the mock or the import fails.
vi.mock('../mcp/epiq-api.js', () => ({
	deriveGuiState: vi.fn(),
	getGuiState: vi.fn(),
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	checkoutStateAt: vi.fn(),
	getEventTimeline: vi.fn(),
	getTimeTravelStatus: vi.fn(() => ({mode: 'live', asOfTime: null})),
	returnToLive: vi.fn(),
	runExclusive: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../lib/commits/commits.js', () => ({
	getCommitDiff: vi.fn(),
	getCommitsForRef: vi.fn(),
	getCommitTimeline: vi.fn(),
	getSquashedDiffForRef: vi.fn(),
	openCommitDiffInEditor: vi.fn(),
}));

import {getGuiState} from '../mcp/epiq-api.js';
import {getEventTimeline} from '../mcp/epiq-time-travel.js';
import {succeeded} from '../lib/model/result-types.js';
import {setupWebsocket} from '../gui/api/lib/websocket.js';

describe('a client opening the board', () => {
	let server: http.Server;
	let client: WebSocket;
	let received: string[] = [];
	let order: string[] = [];
	let releaseBoot: () => void = () => {};

	const waitFor = async (predicate: () => boolean, label: string) => {
		const deadline = Date.now() + 2000;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	};

	const send = (type: string, payload?: unknown) =>
		client.send(JSON.stringify({type, ...(payload ? {payload} : {})}));

	beforeEach(async () => {
		vi.clearAllMocks();
		received = [];
		order = [];

		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		// Held mid-await, as a boot is while git answers.
		vi.mocked(getGuiState).mockImplementation(async () => {
			await new Promise<void>(resolve => {
				releaseBoot = resolve;
			});
			order.push('board');
			return succeeded('state', {boards: []} as never);
		});
		vi.mocked(getEventTimeline).mockImplementation(async () => {
			order.push('timeline');
			return succeeded('timeline', {events: [], buckets: []} as never);
		});

		server = http.createServer();
		let boundPort = 0;
		setupWebsocket(
			server,
			{repoRoot: '/repo'},
			{
				onStateChanged: vi.fn(),
				onSyncSettingsChanged: vi.fn(),
				getPort: () => boundPort,
			},
		);
		await new Promise<void>(resolve => server.listen(0, resolve));
		boundPort = (server.address() as AddressInfo).port;

		client = new WebSocket(`ws://127.0.0.1:${boundPort}/ws`);
		client.on('message', raw => {
			received.push((JSON.parse(raw.toString()) as {type: string}).type);
		});
		await new Promise(resolve => client.once('open', resolve));
	});

	afterEach(async () => {
		client.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	// The timeline's index build is synchronous; in the gap while the board's
	// boot awaits git it would run first and hold the board back behind it.
	it('builds the timeline only once its board has been sent', async () => {
		send('state:get');
		send('timeline:get', {requestId: 1});

		await waitFor(() => vi.mocked(getGuiState).mock.calls.length > 0, 'boot');
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(order).toEqual([]);

		releaseBoot();
		await waitFor(() => received.includes('timeline'), 'the timeline');

		expect(order).toEqual(['board', 'timeline']);
		expect(received.indexOf('state')).toBeLessThan(
			received.indexOf('timeline'),
		);
	});

	it('answers a timeline asked for alone', async () => {
		send('timeline:get', {requestId: 1});

		await waitFor(() => received.includes('timeline'), 'the timeline');
		expect(order).toEqual(['timeline']);
	});
});
