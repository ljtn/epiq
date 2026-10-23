import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// A remote that keeps git's reasons to itself, as GitHub does over ssh: the
// wrapper runs the command with its stderr dropped, so a refusal reaches the
// client as only "the remote end hung up". The environment is read when the
// module loads, so it is set before the import.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-quiet-'));
const quietSsh = path.join(scratch, 'quiet-ssh.sh');
fs.writeFileSync(
	quietSsh,
	[
		'#!/bin/sh',
		// ssh is called as `ssh [options] <host> '<command>'`: the command runs here.
		'for last; do :; done',
		'exec sh -c "$last" 2>/dev/null',
		'',
	].join('\n'),
);
fs.chmodSync(quietSsh, 0o755);
process.env['GIT_SSH_COMMAND'] = quietSsh;

const {fetchCommitRepos, repoIdOf} = await import('../lib/commits/commits.js');
const {connectRepoEvent} = await import('./helpers/repo-events.js');
const {getRepoClonePath} = await import('../lib/commits/commit-repos.js');

afterAll(() => {
	fs.rmSync(scratch, {recursive: true, force: true});
});

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[], date: string) =>
	childProcess.execFileSync('git', args, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_DATE: date,
		},
	});

/** A board made in 2020, and a remote whose every commit predates it. */
const setUp = (projectId: string) => {
	const board = fs.mkdtempSync(path.join(scratch, 'board-'));
	fs.mkdirSync(path.join(board, '.epiq'));
	fs.writeFileSync(
		path.join(board, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: 'epiq/state',
			createdAt: '2020-01-01T00:00:00.000Z',
		}),
	);

	const upstream = fs.mkdtempSync(path.join(scratch, 'up-'));
	git(upstream, ['init', '-q', '-b', 'main'], '2019-01-01T00:00:00Z');
	for (const date of ['2019-01-01T00:00:00Z', '2019-06-01T00:00:00Z']) {
		git(upstream, ['commit', '-q', '--allow-empty', '-m', 'old'], date);
	}

	return {board, url: `ssh://localhost${upstream}`};
};

describe('a remote that hides why it refused a window', () => {
	it('still connects a repo with nothing in the window', async () => {
		const {board, url} = setUp('quiet-connect');
		connectRepoEvent(board, url);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			fs.existsSync(getRepoClonePath('quiet-connect', repoIdOf(url))),
		).toBe(true);
	}, 30_000);

	it('widens the window to a day still past the tip without starting over', async () => {
		const {board, url} = setUp('quiet-widen');
		connectRepoEvent(board, url);
		value(await fetchCommitRepos({repoRoot: board}));
		const marker = path.join(
			getRepoClonePath('quiet-widen', repoIdOf(url)),
			'epiq-test-marker',
		);
		fs.writeFileSync(marker, '');

		connectRepoEvent(board, url, {since: '2019-09-01'});
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(marker)).toBe(true);
	}, 30_000);
});
