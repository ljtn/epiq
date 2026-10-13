import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

// A start-over this process's own shutdown cut short: git was stopped by the
// signal, which says nothing about the clone, so the backoff does not grow.
vi.mock('../git/git-utils.js', async () => ({
	...(await vi.importActual<typeof import('../git/git-utils.js')>(
		'../git/git-utils.js',
	)),
	isShuttingDown: () => true,
}));

const {fetchCommitRepos, repoIdOf, upsertCommitRepo} = await import(
	'../lib/commits/commits.js'
);
const {getRepoClonePath} = await import('../lib/commits/commit-repos.js');
const {setConfig} = await import('../lib/config/user-config.js');

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[]) =>
	childProcess.execFileSync('git', args, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Test',
			GIT_AUTHOR_EMAIL: 'test@example.com',
			GIT_COMMITTER_NAME: 'Test',
			GIT_COMMITTER_EMAIL: 'test@example.com',
		},
	});

describe('a start-over the shutdown cut short', () => {
	it('is not counted toward the backoff', async () => {
		const board = makeTempDir();
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'shutdown-board',
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		const upstream = makeTempDir();
		git(upstream, ['init', '-q', '-b', 'main']);
		fs.writeFileSync(path.join(upstream, 'big.bin'), Buffer.alloc(0));
		fs.writeFileSync(
			path.join(upstream, 'big.bin'),
			// Random: git cannot compress it under the cap.
			Buffer.from(
				Array.from({length: 3 * 1024 * 1024}, () => Math.random() * 256),
			),
		);
		git(upstream, ['add', 'big.bin']);
		git(upstream, ['commit', '-q', '-m', 'AAAAAAA big']);
		const url = `file://${upstream}`;
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		const clonePath = getRepoClonePath('shutdown-board', repoIdOf(url));

		// Broken, with a re-clone that fails as a stopped one does.
		fs.writeFileSync(path.join(clonePath, 'config'), '');
		setConfig({repoCloneMaxMb: 1});
		try {
			value(await fetchCommitRepos({repoRoot: board}));
		} finally {
			setConfig({repoCloneMaxMb: undefined});
		}

		const status = JSON.parse(fs.readFileSync(`${clonePath}.json`, 'utf8'));
		expect(status.restarts).toBe(0);
		expect(status.restartTriedAt).toBeNull();
	});
});
