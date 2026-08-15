import fs from 'node:fs';
import {startGuiServer} from '../../gui/api/api-server.js';
import {isFail} from '../../lib/model/result-types.js';
import {seedProject} from './seed-tui.js';
import {HANDOFF_PATH, type Handoff} from './handoff.js';

// Its own `tsx` process rather than Playwright's global setup: seeding drives
// a real pty, which Playwright's loader cannot host.

const main = async () => {
	const repoRoot = await seedProject();

	const result = await startGuiServer({repoRoot, boardId: ''});
	if (isFail(result)) throw new Error(result.message);

	const address = result.value.server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Unable to resolve GUI server address');
	}

	const handoff: Handoff = {
		// The server reports epiq.localhost; the loopback address is what a
		// browser can be relied on to resolve.
		baseUrl: `http://127.0.0.1:${address.port}`,
		repoRoot,
	};

	fs.writeFileSync(HANDOFF_PATH, JSON.stringify(handoff));

	const shutdown = () => {
		result.value.server.close();
		fs.rmSync(HANDOFF_PATH, {force: true});
		fs.rmSync(repoRoot, {recursive: true, force: true});
		process.exit(0);
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
};

void main();
