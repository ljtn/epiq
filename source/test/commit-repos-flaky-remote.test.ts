import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// A remote that drops one connection, as a network does now and then: over
// ssh to a wrapper that counts its calls and fails the one it is told to. The
// environment is read when the module loads, so it is set before the import.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-flaky-'));
const count = path.join(scratch, 'count');
const failAt = path.join(scratch, 'fail-at');
const flakySsh = path.join(scratch, 'flaky-ssh.sh');
fs.writeFileSync(
	flakySsh,
	[
		'#!/bin/sh',
		`n=$(( $(cat "${count}" 2>/dev/null || echo 0) + 1 ))`,
		`echo "$n" > "${count}"`,
		`if [ "$n" = "$(cat "${failAt}" 2>/dev/null)" ]; then`,
		'  echo "Connection reset by peer" >&2',
		'  exit 255',
		'fi',
		// ssh is called as `ssh <host> '<command>'`: the command runs here.
		'shift',
		'exec sh -c "$1"',
		'',
	].join('\n'),
);
fs.chmodSync(flakySsh, 0o755);
process.env['GIT_SSH_COMMAND'] = flakySsh;

const {fetchCommitRepos, repoIdOf, upsertCommitRepo} = await import(
	'../lib/commits/commits.js'
);
const {getRepoClonePath} = await import('../lib/commits/commit-repos.js');

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

describe('a fetch the network drops once', () => {
	it('is tried again before the clone is started over', async () => {
		const board = fs.mkdtempSync(path.join(scratch, 'board-'));
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'flaky-board',
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		const upstream = fs.mkdtempSync(path.join(scratch, 'up-'));
		git(upstream, ['init', '-q', '-b', 'main']);
		git(upstream, ['commit', '-q', '--allow-empty', '-m', 'AAAAAAA one']);

		const url = `ssh://localhost${upstream}`;
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		const marker = path.join(
			getRepoClonePath('flaky-board', repoIdOf(url)),
			'epiq-test-marker',
		);
		fs.writeFileSync(marker, '');

		git(upstream, ['commit', '-q', '--allow-empty', '-m', 'AAAAAAA two']);
		// The next fetch looks up the remote's default, then fetches: that
		// fetch is the call dropped. git reaches ssh twice a call, the first
		// time only to ask which ssh it is.
		const calls = Number(fs.readFileSync(count, 'utf8'));
		fs.writeFileSync(failAt, String(calls + 4));

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(marker)).toBe(true);
	}, 30_000);
});
