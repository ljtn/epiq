import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {readConnectedRepos} from '../../lib/commits/commit-repos.js';
import {isFail} from '../../lib/model/result-types.js';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {commandLineIsIdle, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;

const git = (cwd: string, args: string) =>
	execSync(`git ${args}`, {cwd, stdio: 'ignore'});

/** Polls the board's log: an idle TUI draws no frame to wait on. */
const until = async (check: () => boolean, timeoutMs: number) => {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('Timed out');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
};

const connectedRepos = (cwd: string) => {
	const repos = readConnectedRepos(cwd);
	return isFail(repos) ? [] : repos.value.live;
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

describe('TUI repos e2e', () => {
	it(
		':config repoConnect previews a repo, connects it on confirm, and repoDisconnect takes it out',
		async () => {
			const tui = setupTui();
			// Short, so the confirm line still fits the pane.
			const upstream = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));

			try {
				await commonSteps.init(tui);
				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				git(upstream, 'init -q -b main');
				git(
					upstream,
					'-c user.name=t -c user.email=t@t commit -q --allow-empty -m init',
				);
				const url = `file://${upstream}`;

				// One option: the line is drawn whole only while it fits the pane.
				await typeCommand(tui, `:config repoConnect ${url} label=mirror`);
				// The preview leaves the confirm line typed out, saying what it is.
				await tui.waitFor(/mirror from/, 10_000);
				await tui.waitFor('confirm', 4_000);
				expect(connectedRepos(tui.cwd)).toEqual([]);

				tui.input(ENTER);
				await tui.waitFor(commandLineIsIdle, 5_000);
				await until(() => connectedRepos(tui.cwd).length > 0, 5_000);

				expect(connectedRepos(tui.cwd)).toMatchObject([
					{url, branches: 'default', since: 'board', label: 'mirror'},
				]);

				// The hint offers it by name.
				tui.input(':config repoDisconnect ');
				await tui.waitFor('mirror', 4_000);
				tui.input('\x7f'.repeat(40));
				await tui.waitFor(commandLineIsIdle, 4_000);

				await typeCommand(tui, ':config repoDisconnect mirror');
				await until(() => connectedRepos(tui.cwd).length === 0, 5_000);
			} finally {
				await tui.destroy();
				fs.rmSync(upstream, {recursive: true, force: true});
			}
		},
		testTimeout,
	);
});
