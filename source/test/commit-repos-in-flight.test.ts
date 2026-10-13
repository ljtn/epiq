import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// A fetch in flight when a remove lands. The remove finds the clone held and
// marks it; the holder's own exit is what deletes it, so the mark must land
// while the fetch is inside git. Over ssh to a wrapper that sleeps and then
// runs upload-pack locally: the environment is read when the module loads, so
// it is set before the import below.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-in-flight-'));
const slowSsh = path.join(scratch, 'slow-ssh.sh');
fs.writeFileSync(
	slowSsh,
	// ssh is called as `ssh <host> '<command>'`: the command runs here.
	'#!/bin/sh\nsleep 1.5\nshift\nexec sh -c "$1"\n',
);
fs.chmodSync(slowSsh, 0o755);
process.env['GIT_SSH_COMMAND'] = slowSsh;

const {
	fetchCommitRepos,
	removeCommitRepo,
	removeRepoClone,
	repoIdOf,
	upsertCommitRepo,
} = await import('../lib/commits/commits.js');
const {getRepoClonePath} = await import('../lib/commits/commit-repos.js');
const {execGit} = await import('../git/git-utils.js');

afterAll(() => {
	fs.rmSync(scratch, {recursive: true, force: true});
});

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[]) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		})
		.toString();

const PROJECT_ID = 'in-flight-board';

describe('a remove that lands while the clone is inside git', () => {
	it('is honoured by the fetch that held it, on its way out', async () => {
		const board = fs.mkdtempSync(path.join(scratch, 'board-'));
		git(board, ['init', '-q', '-b', 'main']);
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		fs.writeFileSync(path.join(board, 'a'), 'a');
		git(board, ['add', '-A']);
		git(board, ['commit', '-q', '-m', 'init']);

		const upstream = fs.mkdtempSync(path.join(scratch, 'up-'));
		git(upstream, ['init', '-q', '-b', 'main']);
		fs.writeFileSync(path.join(upstream, 'u'), 'u');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-q', '-m', 'AAAAAAA upstream']);

		const url = `ssh://localhost${upstream}`;
		value(upsertCommitRepo({repoRoot: board, url}));
		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));

		const running = fetchCommitRepos({repoRoot: board});
		// Inside the clone's sleep: the lock is held, so the remove marks.
		await new Promise(resolve => setTimeout(resolve, 600));
		value(removeCommitRepo({repoRoot: board, repo: url}));
		expect(
			value(removeRepoClone({repoRoot: board, repoId: repoIdOf(url)})),
		).toBeNull();
		expect(fs.existsSync(`${clonePath}.removed`)).toBe(true);

		value(await running);

		expect(fs.existsSync(clonePath)).toBe(false);
		expect(fs.existsSync(`${clonePath}.removed`)).toBe(false);
	}, 30_000);
});

describe('a transfer its caller stops', () => {
	// What the clone cap stops a transfer with: git goes at once, and the
	// failure ends on the caller's reason, which is what the repo reports.
	it('ends then, on the reason it was given', async () => {
		const controller = new AbortController();
		const started = Date.now();
		setTimeout(() => controller.abort('past the cap'), 100);

		const result = await execGit({
			cwd: scratch,
			args: ['ls-remote', 'ssh://example.invalid/repo.git'],
			forClone: true,
			abort: controller.signal,
		});

		expect(isFail(result)).toBe(true);
		expect(isFail(result) ? result.message.split('\n').pop() : '').toBe(
			'past the cap',
		);
		expect(Date.now() - started).toBeLessThan(1_400);
	});
});
