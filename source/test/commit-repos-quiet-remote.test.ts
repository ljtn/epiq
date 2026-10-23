import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// A remote that keeps git's reasons to itself, as GitHub does over ssh: the
// wrapper runs the command with its stderr dropped, so a refusal reaches the
// client as only "the remote end hung up". With the drop file there, the
// transfer after as many as it counts is cut off instead, which reads the
// same. The environment is read when the module loads, so it is set before the
// import.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-quiet-'));
const quietSsh = path.join(scratch, 'quiet-ssh.sh');
const drop = path.join(scratch, 'drop');
fs.writeFileSync(
	quietSsh,
	[
		'#!/bin/sh',
		// ssh is called as `ssh [options] <host> '<command>'`: the command runs here.
		'for last; do :; done',
		// git first calls it with the host alone, to learn which ssh it is.
		'case "$last" in *upload-pack*)',
		`  if [ -f "${drop}" ]; then`,
		`    n=$(cat "${drop}")`,
		`    if [ "$n" = 0 ]; then rm "${drop}"; exit 255; fi`,
		`    echo $((n - 1)) > "${drop}"`,
		'  fi;;',
		'esac',
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

/** A board made in 2020, and a remote whose commits predate it but for `recent`. */
const setUp = (projectId: string, recent: string[] = []) => {
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
	for (const date of [
		'2019-01-01T00:00:00Z',
		'2019-06-01T00:00:00Z',
		...recent,
	]) {
		git(upstream, ['commit', '-q', '--allow-empty', '-m', 'old'], date);
	}

	return {board, upstream, url: `ssh://localhost${upstream}`};
};

const commitsIn = (projectId: string, url: string) =>
	Number(
		git(
			getRepoClonePath(projectId, repoIdOf(url)),
			['rev-list', '--count', '--all'],
			'2019-01-01T00:00:00Z',
		)
			.toString()
			.trim(),
	);

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

	it('fails a connect cut off with commits in the window, and clones all of it next time', async () => {
		const {board, url} = setUp('quiet-cut-clone', ['2021-01-01T00:00:00Z']);
		connectRepoEvent(board, url);
		fs.writeFileSync(drop, '0');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(
			fs.existsSync(getRepoClonePath('quiet-cut-clone', repoIdOf(url))),
		).toBe(false);

		// A changed option fetches again, past the failure's backoff.
		connectRepoEvent(board, url, {label: 'again'});
		const [again] = value(await fetchCommitRepos({repoRoot: board}));
		expect(again!.ok).toBe(true);
		// The 2021 commit and the 2019 one before it, as its boundary.
		expect(commitsIn('quiet-cut-clone', url)).toBe(2);
	}, 30_000);

	it('widens the window after a widening fetch is cut off', async () => {
		const {board, url} = setUp('quiet-cut-widen', ['2019-10-01T00:00:00Z']);
		connectRepoEvent(board, url);
		value(await fetchCommitRepos({repoRoot: board}));
		expect(commitsIn('quiet-cut-widen', url)).toBe(1);

		connectRepoEvent(board, url, {since: '2019-09-01'});
		// Past the lookup of the remote's default branch, to the fetch.
		fs.writeFileSync(drop, '1');
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(commitsIn('quiet-cut-widen', url)).toBe(2);
	}, 30_000);
});
