import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	describeFetchFailures,
	fetchCommitRepos,
	getCommitsForRef,
	listRepoStates,
	removeCommitRepo,
	removeRepoClone,
	repoIdOf,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {getRepoClonePath} from '../lib/commits/commit-repos.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

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

const commit = (cwd: string, message: string) => {
	fs.appendFileSync(path.join(cwd, 'f.txt'), `${message}\n`);
	git(cwd, ['add', 'f.txt']);
	git(cwd, ['commit', '-q', '-m', message]);
};

const PROJECT_ID = 'fetch-review';

const writeProject = (root: string, extra: Record<string, unknown> = {}) =>
	fs.writeFileSync(
		path.join(root, '.epiq', 'project.json'),
		JSON.stringify(
			{
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
				...extra,
			},
			null,
			2,
		) + '\n',
	);

/** Another live process holding the clone's lock. */
const holdLock = (clonePath: string) =>
	fs.writeFileSync(
		`${clonePath}.lock`,
		JSON.stringify({
			pid: process.ppid,
			hostname: os.hostname(),
			startedAt: Date.now(),
			operation: 'fetch',
		}),
	);

let board: string;
let upstream: string;
let url: string;
let clonePath: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
	git(board, ['init', '-q', '-b', 'main']);
	fs.mkdirSync(path.join(board, '.epiq'));
	writeProject(board);
	commit(board, 'init');
	git(board, ['branch', 'epiq/state']);

	upstream = makeTempDir();
	git(upstream, ['init', '-q', '-b', 'main']);
	commit(upstream, 'init');
	url = `file://${upstream}`;
	clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe('a clone the list stops naming', () => {
	// A branch switch, pull or rebase rewrites project.json while a fetch runs;
	// the clone is shared with every worktree, which may still list it.
	it('is kept when the list changes under a running fetch', async () => {
		commit(upstream, 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));

		const running = fetchCommitRepos({repoRoot: board});
		writeProject(board);
		value(await running);

		expect(fs.existsSync(clonePath)).toBe(true);
	});

	it('is deleted by the fetch that held it when it was removed', async () => {
		commit(upstream, 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		holdLock(clonePath);
		value(removeCommitRepo({repoRoot: board, repo: url}));
		expect(
			value(removeRepoClone({repoRoot: board, repoId: repoIdOf(url)})),
		).toBeNull();
		expect(fs.existsSync(clonePath)).toBe(true);
		fs.rmSync(`${clonePath}.lock`);

		// The holder, still listing the repo, takes the clone next and honours
		// the remove before anything else.
		value(upsertCommitRepo({repoRoot: board, url}));
		const statusBefore = fs.statSync(`${clonePath}.json`).mtimeMs;
		value(await fetchCommitRepos({repoRoot: board}));

		expect(fs.existsSync(`${clonePath}.removed`)).toBe(false);
		expect(fs.statSync(`${clonePath}.json`).mtimeMs).not.toBe(statusBefore);
	});
});

describe('a fetch that fails', () => {
	it("says git's reason, not the command it ran", async () => {
		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${path.join(makeTempDir(), 'missing')}`,
			}),
		);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(outcome!.message).not.toMatch(/^git |-c |core\.hooksPath/);
		// The line naming the cause, not the stock one git ends on.
		expect(outcome!.message).toMatch(/does not appear to be a git repository/);
		expect(value(listRepoStates(board))[0]!.error).toBe(outcome!.message);
	});

	it('is not what an empty repository gets', async () => {
		const empty = makeTempDir();
		git(empty, ['init', '-q', '-b', 'main']);
		value(upsertCommitRepo({repoRoot: board, url: `file://${empty}`}));

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome).toMatchObject({ok: true});
	});

	it('leaves a clone that cannot be read named in the list', async () => {
		commit(upstream, 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		fs.rmSync(path.join(clonePath, 'objects'), {recursive: true});
		fs.mkdirSync(path.join(clonePath, 'objects'));
		resetCommitTimelineCacheForTests();
		value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}));

		expect(value(listRepoStates(board))[0]!.error).toMatch(/could not be read/);
	});
});

describe('another process on the same clone', () => {
	it('does not answer an explicit fetch as if it had fetched', async () => {
		commit(upstream, 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		holdLock(clonePath);
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		fs.rmSync(`${clonePath}.lock`);

		expect(outcome).toMatchObject({ok: true, skipped: true});
	}, 20_000);

	it('lets a throttled pass through without the lock', async () => {
		commit(upstream, 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		holdLock(clonePath);
		const [outcome] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		fs.rmSync(`${clonePath}.lock`);

		expect(outcome).toMatchObject({ok: true, message: 'Fetched recently'});
		expect(outcome).not.toHaveProperty('skipped');
	});

	it('is seen to have moved the clone on the next throttled pass here', async () => {
		commit(upstream, 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		// Another process's fetch, as far as this one can tell.
		commit(upstream, 'AAAAAAA second');
		git(clonePath, ['--git-dir=.', 'fetch', '-q', 'origin']);

		const [outcome] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		expect(outcome).toMatchObject({message: 'Fetched recently', changed: true});
	});

	it('keeps a clone whose config could not be read rather than deleting it', async () => {
		commit(upstream, 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const marker = path.join(clonePath, 'epiq-test-marker');
		fs.writeFileSync(marker, '');
		const config = path.join(clonePath, 'config');
		fs.chmodSync(config, 0o000);
		try {
			await fetchCommitRepos({repoRoot: board});
		} finally {
			fs.chmodSync(config, 0o644);
		}

		expect(fs.existsSync(marker)).toBe(true);
	});
});

describe('what a process is told about a clone', () => {
	it('is changed on its first fetch that brings commits, though another process cloned it', async () => {
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		commit(upstream, 'AAAAAAA upstream');

		// A process that has never looked at the clone.
		vi.resetModules();
		const fresh = await import('../lib/commits/commits.js');
		const [outcome] = value(await fresh.fetchCommitRepos({repoRoot: board}));

		expect(outcome).toMatchObject({ok: true, changed: true});
	});

	it('names a repo another process is fetching in the sync text', () => {
		expect(
			describeFetchFailures([
				{
					id: 'api-0123456789ab',
					label: 'api',
					ok: true,
					changed: false,
					skipped: true,
					message: 'Being fetched by another process',
				},
			]),
		).toBe('another process is fetching api');
	});
});
