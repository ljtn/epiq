import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startGuiServer} from '../../gui/api/api-server.js';
import {isFail} from '../../lib/model/result-types.js';
import {seedProject} from './seed-tui.js';
import {HANDOFF_PATH, type Handoff} from './handoff.js';

// Its own `tsx` process rather than Playwright's global setup: seeding drives
// a real pty, which Playwright's loader cannot host.

const servers: Array<{close: () => void}> = [];

// The server reports epiq.localhost; the loopback address is what a browser can
// be relied on to resolve.
const serve = async (repoRoot: string): Promise<string> => {
	const result = await startGuiServer({repoRoot, boardId: ''});
	if (isFail(result)) throw new Error(result.message);

	const address = result.value.server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Unable to resolve GUI server address');
	}

	servers.push(result.value.server);

	return `http://127.0.0.1:${address.port}`;
};

const main = async () => {
	const repoRoot = await seedProject();
	const bareRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-gui-bare-'));

	const handoff: Handoff = {
		baseUrl: await serve(repoRoot),
		repoRoot,
		bareUrl: await serve(bareRepoRoot),
		bareRepoRoot,
	};

	// The server boots the repo on its first request; taken here rather than
	// by the first test, whose 10s expectation is not enough for it under a
	// full set of workers starting at once.
	await fetch(`${handoff.baseUrl}/api/state`);

	fs.writeFileSync(HANDOFF_PATH, JSON.stringify(handoff));

	const shutdown = () => {
		for (const server of servers) server.close();
		fs.rmSync(HANDOFF_PATH, {force: true});
		fs.rmSync(repoRoot, {recursive: true, force: true});
		fs.rmSync(bareRepoRoot, {recursive: true, force: true});
		process.exit(0);
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
};

void main();
