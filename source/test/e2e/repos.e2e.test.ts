import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {commandLineIsIdle, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;

const git = (cwd: string, args: string) =>
	execSync(`git ${args}`, {cwd, stdio: 'ignore'});

/** Polls the project file: an idle TUI draws no frame to wait on. */
const until = async (check: () => boolean, timeoutMs: number) => {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('Timed out');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
};

const projectRepos = (cwd: string): unknown =>
	JSON.parse(fs.readFileSync(path.join(cwd, '.epiq', 'project.json'), 'utf8'))
		.repos;

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
		':config repoAdd lists a repo in project.json, and repoRemove takes it out',
		async () => {
			const tui = setupTui();
			const upstream = fs.mkdtempSync(
				path.join(os.tmpdir(), 'epiq-e2e-upstream-'),
			);

			try {
				await commonSteps.init(tui);
				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				git(upstream, 'init -q -b main');
				const url = `file://${upstream}`;

				// One option: the line is drawn whole only while it fits the pane.
				await typeCommand(tui, `:config repoAdd ${url} label=mirror`);
				await tui.waitFor(commandLineIsIdle, 5_000);
				await until(() => projectRepos(tui.cwd) !== undefined, 5_000);

				expect(projectRepos(tui.cwd)).toEqual([
					{url, branches: 'default', since: 'board', label: 'mirror'},
				]);

				// The hint offers it by name.
				tui.input(':config repoRemove ');
				await tui.waitFor('mirror', 4_000);
				tui.input('\x7f'.repeat(40));
				await tui.waitFor(commandLineIsIdle, 4_000);

				await typeCommand(tui, ':config repoRemove mirror');
				await until(() => projectRepos(tui.cwd) === undefined, 5_000);
			} finally {
				await tui.destroy();
				fs.rmSync(upstream, {recursive: true, force: true});
			}
		},
		testTimeout,
	);
});
