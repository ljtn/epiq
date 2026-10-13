import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// `safe.bareRepository=explicit` is common hardening: git then refuses a bare
// repository it found only by its working directory. epiq's clones of other
// repos are bare, so every read of one has to name it. Set as command-line
// config through the environment, before git-utils captures it at import —
// which is why nothing above may import anything that reaches git-utils.
process.env['GIT_CONFIG_COUNT'] = '1';
process.env['GIT_CONFIG_KEY_0'] = 'safe.bareRepository';
process.env['GIT_CONFIG_VALUE_0'] = 'explicit';

const {fetchCommitRepos, getCommitDiff, getCommitsForRef} = await import(
	'../lib/commits/commits.js'
);
const {connectRepoEvent} = await import('./helpers/repo-events.js');
const {discardStage, stageClone} = await import(
	'../lib/commits/commit-repo-fetch.js'
);
const {repoIdOf} = await import('../lib/board/board-repos.js');

const tempDirs: string[] = [];
const makeTempDir = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-safe-bare-'));
	tempDirs.push(dir);
	return dir;
};

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true});
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

const commit = (cwd: string, file: string, message: string) => {
	fs.appendFileSync(path.join(cwd, file), `${message}\n`);
	git(cwd, ['add', file]);
	git(cwd, ['commit', '-q', '-m', message]);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

describe('a clone under safe.bareRepository=explicit', () => {
	it('is still read, logged and diffed', async () => {
		const board = makeTempDir();
		git(board, ['init', '-q', '-b', 'main']);
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'safe-bare',
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		commit(board, 'init.txt', 'init');
		git(board, ['branch', 'epiq/state']);

		const upstream = makeTempDir();
		git(upstream, ['init', '-q', '-b', 'main']);
		commit(upstream, 'init.txt', 'init');
		const sha = commit(upstream, 'up.txt', 'AAAAAAA upstream');

		connectRepoEvent(board, `file://${upstream}`);
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcome!.ok).toBe(true);

		const matched = value(
			await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}),
		);
		expect(matched.map(entry => entry.sha)).toEqual([sha]);

		const diff = value(
			await getCommitDiff({repoRoot: board, sha, repo: matched[0]!.repo}),
		);
		expect(diff.files.map(file => [file.path, file.after])).toEqual([
			['up.txt', 'AAAAAAA upstream\n'],
		]);
	});
});

describe('a pre-flight under safe.bareRepository=explicit', () => {
	it('stages a clone it can read', async () => {
		const board = makeTempDir();
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: path.basename(board),
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);

		const upstream = makeTempDir();
		git(upstream, ['init', '-q', '-b', 'main']);
		commit(upstream, 'init.txt', 'init');
		const url = `file://${upstream}`;

		const staged = value(
			await stageClone(board, {
				id: repoIdOf(url),
				url,
				branches: 'default',
				since: 'all',
				label: 'up',
			}),
		);

		expect(fs.existsSync(path.join(staged.stagePath, 'HEAD'))).toBe(true);
		discardStage(staged.stagePath);
	});
});
