import http from 'node:http';
import {AddressInfo} from 'node:net';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebSocket} from 'ws';

// Every API entry point the websocket module imports has to exist on the mock,
// even the ones these tests never exercise, or the import itself fails.
vi.mock('../mcp/epiq-api.js', () => ({
	addIssueAssignee: vi.fn(),
	getBoardContributors: vi.fn(),
	redactContributor: vi.fn(),
	addIssueComment: vi.fn(),
	addIssueTag: vi.fn(),
	closeIssue: vi.fn(),
	createIssue: vi.fn(),
	deleteIssueComment: vi.fn(),
	deriveGuiState: vi.fn(),
	editIssueDescription: vi.fn(),
	editIssueTitle: vi.fn(),
	getGuiState: vi.fn(),
	listIssues: vi.fn(),
	moveIssue: vi.fn(),
	removeIssueAssignee: vi.fn(),
	removeIssueTag: vi.fn(),
	reopenIssue: vi.fn(),
	sync: vi.fn(),
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	checkoutStateAt: vi.fn(),
	getCommitTimeline: vi.fn(),
	getEventTimeline: vi.fn(),
	getTimeTravelStatus: vi.fn(),
	openCommitDiffInEditor: vi.fn(),
	returnToLive: vi.fn(),
	runExclusive: vi.fn(),
}));

import {closeIssue, deriveGuiState, getGuiState} from '../mcp/epiq-api.js';
import {getTimeTravelStatus, runExclusive} from '../mcp/epiq-time-travel.js';
import {succeeded} from '../lib/model/result-types.js';
import {setupWebsocket} from '../gui/api/lib/websocket.js';

// Markers instead of real ApiState: the only thing under test is *which*
// source the refresh was taken from, so the payloads just have to be
// distinguishable.
const LIVE_BOOT = {marker: 'live-boot'};
const DERIVED = {marker: 'derived'};

type ReceivedMessage = {type: string; payload?: {value?: {marker?: string}}};

describe('websocket post-mutation state refresh', () => {
	let server: http.Server;
	let client: WebSocket;
	let received: ReceivedMessage[] = [];

	// The mode the (mocked) time-travel module reports, flipped mid-test to
	// simulate a `time-travel:scrub` landing behind the mutation.
	let mode: 'live' | 'scrub' = 'live';

	const waitFor = async (predicate: () => boolean, label: string) => {
		const deadline = Date.now() + 2000;

		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	};

	const lastStatePayloadMarker = () =>
		received.filter(message => message.type === 'state').at(-1)?.payload?.value
			?.marker;

	beforeEach(async () => {
		vi.clearAllMocks();
		received = [];
		mode = 'live';

		// `logger` is an ambient global assigned onto globalThis as an import side
		// effect in the real app, not a module we can vi.mock here.
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		vi.mocked(getTimeTravelStatus).mockImplementation(() => ({
			mode,
			asOfTime: mode === 'live' ? null : 1234,
		}));

		// Stands in for the real lock: enough to run the handler, since what these
		// tests care about is what happens *after* it has been released.
		vi.mocked(runExclusive).mockImplementation(async fn => fn());

		vi.mocked(deriveGuiState).mockImplementation(() =>
			succeeded('state', DERIVED as never),
		);

		vi.mocked(closeIssue).mockResolvedValue(succeeded('closed', {} as never));

		server = http.createServer();
		setupWebsocket(server, '/repo', {onStateChanged: vi.fn()});

		await new Promise<void>(resolve => server.listen(0, resolve));

		const {port} = server.address() as AddressInfo;
		client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		client.on('message', raw => {
			received.push(JSON.parse(raw.toString()) as ReceivedMessage);
		});

		await new Promise(resolve => client.once('open', resolve));
	});

	afterEach(async () => {
		client.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	const sendClose = () =>
		client.send(
			JSON.stringify({type: 'issue:close', payload: {issueId: 'issue-1'}}),
		);

	it('publishes the derived snapshot when a scrub lands while the deferred refresh is booting', async () => {
		let releaseBoot: () => void = () => {};
		let bootStarted = false;

		vi.mocked(getGuiState).mockImplementation(async () => {
			bootStarted = true;
			await new Promise<void>(resolve => {
				releaseBoot = resolve;
			});
			return succeeded('state', LIVE_BOOT as never);
		});

		sendClose();

		await waitFor(() => bootStarted, 'the deferred refresh to start booting');

		// The scrub was queued behind the mutation and wins the lock the moment
		// the mutation released it — i.e. while this boot is still in flight.
		mode = 'scrub';
		releaseBoot();

		await waitFor(
			() => lastStatePayloadMarker() !== undefined,
			'a state broadcast',
		);

		expect(lastStatePayloadMarker()).toBe(DERIVED.marker);
		expect(
			received.some(message => message.type === 'issue:close:result'),
		).toBe(true);
	});

	it('never boots at all when the server has already left live mode', async () => {
		vi.mocked(getGuiState).mockResolvedValue(
			succeeded('state', LIVE_BOOT as never),
		);

		// Flip as the mutation itself resolves, so the mode is already historical
		// by the time the deferred refresh starts running.
		vi.mocked(closeIssue).mockImplementation(async () => {
			mode = 'scrub';
			return succeeded('closed', {} as never);
		});

		sendClose();

		await waitFor(
			() => lastStatePayloadMarker() !== undefined,
			'a state broadcast',
		);

		expect(lastStatePayloadMarker()).toBe(DERIVED.marker);
		expect(getGuiState).not.toHaveBeenCalled();
	});

	it('still publishes the booted snapshot while the server stays live', async () => {
		vi.mocked(getGuiState).mockResolvedValue(
			succeeded('state', LIVE_BOOT as never),
		);

		sendClose();

		await waitFor(
			() => lastStatePayloadMarker() !== undefined,
			'a state broadcast',
		);

		expect(lastStatePayloadMarker()).toBe(LIVE_BOOT.marker);
		expect(getGuiState).toHaveBeenCalledWith({repoRoot: '/repo'});
	});
});
