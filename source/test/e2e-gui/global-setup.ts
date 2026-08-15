import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {HANDOFF_PATH} from './handoff.js';

const READY_TIMEOUT_MS = 120_000;
const POLL_MS = 250;

const globalSetup = async () => {
	fs.rmSync(HANDOFF_PATH, {force: true});

	const child = spawn('npx', ['tsx', 'source/test/e2e-gui/serve.ts'], {
		// Inherited stderr: seeding drives a real TUI through a pty, and when
		// it fails the reason only exists in that output.
		stdio: ['ignore', 'ignore', 'inherit'],
		detached: false,
		// Running from source, so the server has to look for the GUI bundle in
		// dist/gui rather than beside its own module.
		env: {...process.env, IS_LOCAL: 'true'},
	});

	let exited: number | null = null;
	child.on('exit', code => (exited = code ?? 0));

	const deadline = Date.now() + READY_TIMEOUT_MS;

	while (!fs.existsSync(HANDOFF_PATH)) {
		if (exited !== null) {
			throw new Error(`GUI test server exited early with code ${exited}`);
		}

		if (Date.now() > deadline) {
			child.kill('SIGTERM');
			throw new Error('Timed out seeding the GUI test server');
		}

		await new Promise(resolve => setTimeout(resolve, POLL_MS));
	}

	return async () => {
		child.kill('SIGTERM');
	};
};

export default globalSetup;
