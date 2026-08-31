import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	canonicalRepoRoot,
	INSTANCE_PATH,
	probeGuiInstance,
} from '../gui/api/instance.js';

const servers: http.Server[] = [];

const serve = async (
	handler: http.RequestListener,
): Promise<{port: number}> => {
	const server = http.createServer(handler);
	servers.push(server);

	await new Promise<void>(resolve =>
		server.listen(0, '127.0.0.1', () => resolve()),
	);

	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('no port');

	return {port: address.port};
};

const respondWith = (status: number, body: unknown): http.RequestListener =>
	function respond(req, res) {
		if (req.url !== INSTANCE_PATH) {
			res.writeHead(404).end();
			return;
		}

		res.writeHead(status, {'content-type': 'application/json'});
		res.end(JSON.stringify(body));
	};

const validBody = {
	app: 'epiq',
	repoRoot: '/tmp/project',
	version: '1.6.1',
	pid: 4242,
};

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			server =>
				new Promise<void>(resolve => {
					server.closeAllConnections?.();
					server.close(() => resolve());
				}),
		),
	);
});

describe('probeGuiInstance', () => {
	it('identifies an epiq holding the port', async () => {
		const {port} = await serve(respondWith(200, validBody));

		expect(await probeGuiInstance(port)).toEqual(validBody);
	});

	// Every unusable answer collapses to null, because the caller does the same
	// thing for all of them: start its own server.
	it('returns null for a server that is not epiq', async () => {
		const {port} = await serve(respondWith(200, {app: 'vite', repoRoot: '/x'}));

		expect(await probeGuiInstance(port)).toBeNull();
	});

	it('returns null for a body missing fields', async () => {
		const {port} = await serve(respondWith(200, {app: 'epiq'}));

		expect(await probeGuiInstance(port)).toBeNull();
	});

	it('returns null for a non-200', async () => {
		const {port} = await serve(respondWith(500, validBody));

		expect(await probeGuiInstance(port)).toBeNull();
	});

	it('returns null when nothing is listening', async () => {
		// Bound then released, so the port is real and free rather than guessed.
		const {port} = await serve(respondWith(200, validBody));
		await new Promise<void>(resolve => servers[0]!.close(() => resolve()));

		expect(await probeGuiInstance(port)).toBeNull();
	});

	// A server that accepts the socket and never answers would otherwise stall
	// the boot this is meant to speed up.
	it('gives up on a server that never replies', async () => {
		const {port} = await serve(() => {});

		const started = Date.now();
		expect(await probeGuiInstance(port, 150)).toBeNull();
		expect(Date.now() - started).toBeLessThan(3000);
	});
});

describe('canonicalRepoRoot', () => {
	it('resolves a symlinked path to the same string as the real one', () => {
		const base = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-instance-'));
		const real = path.join(base, 'project');
		const link = path.join(base, 'link');
		fs.mkdirSync(real);
		fs.symlinkSync(real, link);

		expect(canonicalRepoRoot(link)).toBe(canonicalRepoRoot(real));
		// A trailing slash names the same project too.
		expect(canonicalRepoRoot(`${real}/`)).toBe(canonicalRepoRoot(real));
	});

	it('falls back to an absolute path when the directory is not there', () => {
		const missing = path.join(os.tmpdir(), 'epiq-not-here-9f3a');

		expect(canonicalRepoRoot(missing)).toBe(path.resolve(missing));
	});
});
