import fs from 'node:fs';
import http from 'node:http';
import {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebSocket} from 'ws';

// Every imported entry point must exist on the mock or the import fails.
vi.mock('../mcp/epiq-api.js', () => ({
	addIssueAssignee: vi.fn(),
	getBoardContributors: vi.fn(),
	tombstoneContributor: vi.fn(),
	addIssueComment: vi.fn(),
	addIssueTag: vi.fn(),
	closeIssue: vi.fn(),
	createIssue: vi.fn(),
	createSwimlane: vi.fn(),
	deleteSwimlane: vi.fn(),
	deleteIssueComment: vi.fn(),
	deriveGuiState: vi.fn(),
	editIssueDescription: vi.fn(),
	editSwimlaneTitle: vi.fn(),
	editIssueTitle: vi.fn(),
	getGuiState: vi.fn(),
	getIssueHistory: vi.fn(),
	listIssues: vi.fn(),
	moveIssue: vi.fn(),
	moveSwimlane: vi.fn(),
	removeIssueAssignee: vi.fn(),
	removeIssueTag: vi.fn(),
	reopenIssue: vi.fn(),
	sync: vi.fn(),
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	checkoutStateAt: vi.fn(),
	getCommitDiff: vi.fn(),
	getCommitsForRef: vi.fn(),
	getCommitTimeline: vi.fn(),
	getEventTimeline: vi.fn(),
	getTimeTravelStatus: vi.fn(() => ({mode: 'live', asOfTime: null})),
	openCommitDiffInEditor: vi.fn(),
	returnToLive: vi.fn(),
	runExclusive: vi.fn(),
}));

import {getGuiState} from '../mcp/epiq-api.js';
import {recordRecentProject} from '../lib/config/recent-projects.js';
import {failed, succeeded} from '../lib/model/result-types.js';
import {NO_PROJECT_MESSAGE} from '../lib/storage/paths.js';
import {setupWebsocket} from '../gui/api/lib/websocket.js';

type Received = {
	type: string;
	payload?: {
		status?: string;
		message?: string;
		repoRoot?: string;
		recentProjects?: Array<{name: string; root: string}>;
		value?: unknown;
	};
};

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-ws-open-'));
	tempDirs.push(dir);
	return dir;
};

const makeProject = (projectId: string): string => {
	const root = path.join(makeTempDir(), projectId);
	fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(root, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: '__epiq_state__',
			createdAt: new Date().toISOString(),
		}),
	);
	return root;
};

describe('websocket project:open', () => {
	let server: http.Server;
	let client: WebSocket;
	let received: Received[] = [];
	let bareRoot: string;
	let projectRoot: string;
	let originalGlobalDir: string | undefined;
	const onStateChanged = vi.fn();

	const waitFor = async (predicate: () => boolean, label: string) => {
		const deadline = Date.now() + 2000;

		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	};

	const send = (message: unknown) => client.send(JSON.stringify(message));
	const ofType = (type: string) => received.filter(m => m.type === type);

	beforeEach(async () => {
		vi.clearAllMocks();
		received = [];

		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
		process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');

		bareRoot = makeTempDir();
		projectRoot = makeProject('01WSOPEN000000000000000001');
		recordRecentProject({root: projectRoot, now: 1});

		// A project answers with state; anywhere else is the init screen.
		vi.mocked(getGuiState).mockImplementation(async ({repoRoot} = {}) =>
			repoRoot === projectRoot
				? succeeded('state', {marker: repoRoot} as never)
				: failed(NO_PROJECT_MESSAGE),
		);

		server = http.createServer();

		let boundPort = 0;
		setupWebsocket(
			server,
			{repoRoot: bareRoot},
			{onStateChanged, getPort: () => boundPort},
		);

		await new Promise<void>(resolve => server.listen(0, resolve));

		const {port} = server.address() as AddressInfo;
		boundPort = port;
		client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		client.on('message', raw => {
			received.push(JSON.parse(raw.toString()) as Received);
		});

		await new Promise(resolve => client.once('open', resolve));
	});

	afterEach(async () => {
		client.close();
		await new Promise<void>(resolve => server.close(() => resolve()));

		if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
		else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;

		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it('lists recent projects alongside the init screen', async () => {
		send({type: 'state:get'});

		await waitFor(
			() => ofType('state:unavailable').length === 1,
			'the init screen',
		);

		const [unavailable] = ofType('state:unavailable');
		expect(unavailable?.payload?.repoRoot).toBe(bareRoot);
		expect(unavailable?.payload?.recentProjects).toEqual([
			expect.objectContaining({
				name: '01WSOPEN000000000000000001',
				root: projectRoot,
			}),
		]);
	});

	it('switches the server to a listed project and answers with its state', async () => {
		send({type: 'project:open', payload: {root: projectRoot}});

		await waitFor(() => ofType('state').length === 1, 'the project state');

		expect(ofType('project:open:result')[0]?.payload?.status).toBe('success');
		expect(ofType('state')[0]?.payload?.value).toEqual(
			expect.objectContaining({marker: projectRoot}),
		);

		// Every later request goes to the opened project, not the bare root.
		send({type: 'state:get'});
		await waitFor(() => ofType('state').length === 2, 'a second state');
		expect(ofType('state')[1]?.payload?.value).toEqual(
			expect.objectContaining({marker: projectRoot}),
		);
		expect(ofType('state:unavailable')).toHaveLength(0);
	});

	it('refuses a root the registry does not list, and stays put', async () => {
		const elsewhere = makeProject('01WSOPEN000000000000000002');

		send({type: 'project:open', payload: {root: elsewhere}});

		await waitFor(
			() => ofType('project:open:result').length === 1,
			'the refusal',
		);

		const [result] = ofType('project:open:result');
		expect(result?.payload?.status).not.toBe('success');
		expect(result?.payload?.message).toContain('Not a recent project');

		send({type: 'state:get'});
		await waitFor(() => ofType('state:unavailable').length === 1, 'init');
		expect(ofType('state:unavailable')[0]?.payload?.repoRoot).toBe(bareRoot);
		expect(getGuiState).not.toHaveBeenCalledWith({repoRoot: elsewhere});
	});

	it('refuses a listed project whose directory has since gone', async () => {
		fs.rmSync(projectRoot, {recursive: true, force: true});

		send({type: 'project:open', payload: {root: projectRoot}});

		await waitFor(
			() => ofType('project:open:result').length === 1,
			'the refusal',
		);

		expect(ofType('project:open:result')[0]?.payload?.status).not.toBe(
			'success',
		);
		expect(ofType('state')).toHaveLength(0);
	});

	it('does not treat opening as a mutation worth syncing', async () => {
		send({type: 'project:open', payload: {root: projectRoot}});

		await waitFor(() => ofType('state').length === 1, 'the project state');

		expect(onStateChanged).not.toHaveBeenCalled();
	});
});
