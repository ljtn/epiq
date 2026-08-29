import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {stripGitHookEnv} from '../setup/git-hook-env.js';
import type {FullConfig} from '@playwright/test';
import {handoffPathFor} from './handoff.js';

const READY_TIMEOUT_MS = 120_000;
const POLL_MS = 250;

// One server per worker: each seeds its own repo and writes its own handoff,
// so workers never share state and files can run side by side.
const serve = (handoffPath: string) => {
	fs.rmSync(handoffPath, {force: true});

	const child = spawn('npx', ['tsx', 'source/test/e2e-gui/serve.ts'], {
		// Inherited stderr: seeding drives a real TUI through a pty, and when
		// it fails the reason only exists in that output.
		stdio: ['ignore', 'ignore', 'inherit'],
		detached: false,
		// Running from source, so the server has to look for the GUI bundle in
		// dist/gui rather than beside its own module.
		env: {
			...process.env,
			IS_LOCAL: 'true',
			EPIQ_GUI_E2E_HANDOFF: handoffPath,
		},
	});

	let exited: number | null = null;
	child.on('exit', code => (exited = code ?? 0));

	return {
		ready: () => fs.existsSync(handoffPath),
		exited: () => exited,
		kill: () => child.kill('SIGTERM'),
	};
};

const globalSetup = async (config: FullConfig) => {
	// Under `git push` this runs from a hook, so git has exported GIT_DIR and
	// friends. The server seeds by driving a real TUI, which would then aim its
	// git at the developer's repository instead of its temp one.
	stripGitHookEnv();

	const servers = Array.from({length: config.workers}, (_, index) =>
		serve(handoffPathFor(index)),
	);

	const deadline = Date.now() + READY_TIMEOUT_MS;

	while (!servers.every(server => server.ready())) {
		const exited = servers.find(server => server.exited() !== null);

		if (exited) {
			for (const server of servers) server.kill();
			throw new Error(
				`GUI test server exited early with code ${exited.exited()}`,
			);
		}

		if (Date.now() > deadline) {
			for (const server of servers) server.kill();
			throw new Error('Timed out seeding the GUI test servers');
		}

		await new Promise(resolve => setTimeout(resolve, POLL_MS));
	}

	return async () => {
		for (const server of servers) server.kill();
	};
};

export default globalSetup;
