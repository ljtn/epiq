import fs from 'node:fs';
import http from 'node:http';
import {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WebSocket} from 'ws';
import {setupWebsocket} from '../gui/api/lib/websocket.js';

// The repos panel waits for a `repos` answer to the change it sent; a refusal
// that came back as a bare `error` left it waiting until it was reopened.

type Received = {
	type: string;
	lastAction?: {ok: boolean; message: string};
	payload?: {status?: string; value?: unknown};
};

describe('a repo change the server refuses', () => {
	let server: http.Server;
	let client: WebSocket;
	let received: Received[] = [];
	const dirs: string[] = [];

	const waitFor = async (predicate: () => boolean, label: string) => {
		const deadline = Date.now() + 2000;
		while (!predicate()) {
			if (Date.now() > deadline) throw new Error(`timed out waiting: ${label}`);
			await new Promise(resolve => setTimeout(resolve, 5));
		}
	};

	const send = (message: unknown) => client.send(JSON.stringify(message));

	beforeEach(async () => {
		received = [];
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-ws-repos-'));
		dirs.push(root);
		fs.mkdirSync(path.join(root, '.epiq'));
		fs.writeFileSync(
			path.join(root, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'ws-repos',
				stateBranch: '__epiq_state__',
				createdAt: new Date().toISOString(),
			}),
		);

		server = http.createServer();
		let boundPort = 0;
		setupWebsocket(
			server,
			{repoRoot: root},
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
			received.push(JSON.parse(raw.toString()) as Received);
		});
		await new Promise(resolve => client.once('open', resolve));
	});

	afterEach(async () => {
		client.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
		for (const dir of dirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});

	it('is answered as a refused change, with the list', async () => {
		send({
			type: 'repo:connect',
			payload: {url: `https://example.com/${'a'.repeat(3000)}`},
		});

		await waitFor(() => received.length > 0, 'an answer');

		expect(received[0]?.type).toBe('repos');
		expect(received[0]?.lastAction?.ok).toBe(false);
		expect(received[0]?.payload?.status).toBe('success');
	});

	it('leaves any other refused frame a plain error', async () => {
		send({type: 'issue:close', payload: {}});

		await waitFor(() => received.length > 0, 'an answer');

		expect(received[0]?.type).toBe('error');
	});
});
