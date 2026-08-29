import http from 'node:http';
import {AddressInfo} from 'node:net';
import {WebSocket} from 'ws';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setupWebsocket} from '../gui/api/lib/websocket.js';

let server: http.Server;
let port: number;

beforeEach(async () => {
	server = http.createServer();

	let boundPort = 0;
	setupWebsocket(
		server,
		{repoRoot: '/repo'},
		{
			onStateChanged: vi.fn(),
			getPort: () => boundPort,
		},
	);

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
	boundPort = port;
});

afterEach(async () => {
	await new Promise<void>(resolve => server.close(() => resolve()));
});

const connect = (origin?: string): Promise<'open' | 'refused'> =>
	new Promise(resolve => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/ws`,
			origin ? {headers: {Origin: origin}} : {},
		);

		socket.on('open', () => {
			socket.close();
			resolve('open');
		});
		socket.on('error', () => resolve('refused'));
	});

// A WebSocket handshake is exempt from the same-origin policy, so any page the
// user has open reached the whole mutation surface — including `sync`, which
// pushes to the shared remote.
describe('websocket handshake origin', () => {
	it('refuses a handshake from a foreign origin', async () => {
		await expect(connect('https://evil.example')).resolves.toBe('refused');
	});

	it('refuses a handshake from another local port', async () => {
		await expect(connect('http://127.0.0.1:9999')).resolves.toBe('refused');
	});

	it('accepts the page this server serves', async () => {
		await expect(connect(`http://epiq.localhost:${port}`)).resolves.toBe(
			'open',
		);
		await expect(connect(`http://127.0.0.1:${port}`)).resolves.toBe('open');
	});

	// curl and the test harness send none; there is no page to be tricked.
	it('accepts a client that sends no Origin at all', async () => {
		await expect(connect()).resolves.toBe('open');
	});
});
