import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	fetchCommitRepos,
	getCommitsForRef,
	getSquashedDiffForRef,
	repoIdOf,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {
	getRepoClonePath,
	getRepoClonesDir,
} from '../lib/commits/commit-repos.js';
import {isFail, Result, succeeded} from '../lib/model/result-types.js';
import {syncThenFetchRepos} from '../mcp/api/repos.js';
import {makeTempDir} from './helpers/git-repo.js';

const REF = 'AAAAAAA';
const PROJECT_ID = 'pins';

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (
	cwd: string,
	args: string[],
	dates: {author?: string; committer?: string} = {},
) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
				...(dates.author ? {GIT_AUTHOR_DATE: dates.author} : {}),
				...(dates.committer ? {GIT_COMMITTER_DATE: dates.committer} : {}),
			},
		})
		.toString();

const commit = (
	cwd: string,
	message: string,
	dates: {author?: string; committer?: string} = {},
) => {
	fs.appendFileSync(path.join(cwd, 'f.txt'), `${message}\n`);
	git(cwd, ['add', 'f.txt']);
	git(cwd, ['commit', '-q', '-m', message], dates);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

let board: string;
let upstream: string;
let url: string;
let clonePath: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
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
	commit(board, 'init', {
		author: '2018-01-01T00:00:00Z',
		committer: '2018-01-01T00:00:00Z',
	});
	git(board, ['branch', 'epiq/state']);

	upstream = makeTempDir();
	git(upstream, ['init', '-q', '-b', 'main']);
	commit(upstream, 'init', {
		author: '2018-01-01T00:00:00Z',
		committer: '2018-01-01T00:00:00Z',
	});
	url = `file://${upstream}`;
	clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe("a repo's history window", () => {
	it('is read by commit date, as the clone is cut, not by author date', async () => {
		commit(upstream, `${REF} rebased into the window`, {
			author: '2019-01-01T00:00:00Z',
			committer: '2021-01-01T00:00:00Z',
		});
		commit(upstream, `${REF} committed before the window`, {
			author: '2021-02-01T00:00:00Z',
			committer: '2019-12-01T00:00:00Z',
		});
		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		// Narrowed on a clone that already holds everything: only the filter
		// stands between the window and what is shown.
		value(upsertCommitRepo({repoRoot: board, url, since: '2020-06-01'}));
		resetCommitTimelineCacheForTests();

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF})).map(
				entry => entry.subject,
			),
		).toEqual([`${REF} rebased into the window`]);
	});
});

describe('a commit a fork shares', () => {
	it('still makes the commit before the fork’s own its predecessor', async () => {
		const shared = commit(board, `${REF} shared`, {
			author: '2024-01-01T00:00:00Z',
		});

		const fork = makeTempDir();
		git(fork, ['clone', '-q', board, '.']);
		const own = commit(fork, `${REF} the fork’s own`, {
			author: '2024-01-02T00:00:00Z',
		});
		value(
			upsertCommitRepo({repoRoot: board, url: `file://${fork}`, since: 'all'}),
		);
		value(await fetchCommitRepos({repoRoot: board}));

		const matched = value(await getCommitsForRef({repoRoot: board, ref: REF}));

		expect(matched.find(entry => entry.sha === own)?.precedingSha).toBe(shared);
	});
});

describe('a clone that breaks', () => {
	it('costs the squashed diff its own files, never the board’s', async () => {
		commit(board, `${REF} board`, {author: '2024-01-01T00:00:00Z'});
		commit(upstream, `${REF} upstream`, {author: '2024-01-02T00:00:00Z'});
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		// The log still lists the clone's commit; reading its trees fails.
		value(await getCommitsForRef({repoRoot: board, ref: REF}));
		fs.rmSync(path.join(clonePath, 'objects', 'pack'), {
			recursive: true,
			force: true,
		});
		for (const dir of fs.readdirSync(path.join(clonePath, 'objects'))) {
			if (/^[0-9a-f]{2}$/.test(dir)) {
				fs.rmSync(path.join(clonePath, 'objects', dir), {recursive: true});
			}
		}

		const diff = await getSquashedDiffForRef({repoRoot: board, ref: REF});

		expect(isFail(diff)).toBe(false);
	});
});

describe('the fetch after a sync', () => {
	it('is not waited on past its budget', async () => {
		commit(upstream, `${REF} upstream`);
		value(upsertCommitRepo({repoRoot: board, url}));

		const result = await syncThenFetchRepos(
			succeeded('Synced', {}),
			{repoRoot: board},
			1,
		);

		expect(result.message).toMatch(/still fetching/);
		// Let it finish here, not in the next test.
		value(await fetchCommitRepos({repoRoot: board}));
	});

	it('runs again for a fetch asked for during a throttled one', async () => {
		commit(upstream, `${REF} first`);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		commit(upstream, `${REF} second`);

		const throttled = fetchCommitRepos({
			repoRoot: board,
			minIntervalMs: 60_000,
		});
		const asked = fetchCommitRepos({repoRoot: board});

		expect(value(await throttled)[0]!.message).toBe('Fetched recently');
		expect(value(await asked)[0]).toMatchObject({
			message: 'Fetched',
			changed: true,
		});
	});
});

describe('what a dead process left', () => {
	it('is cleared: a half-made clone, and a lock on the clone', async () => {
		commit(upstream, `${REF} upstream`);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const dead = 2_147_483_646;
		const pending = path.join(
			getRepoClonesDir(PROJECT_ID),
			`${repoIdOf(url)}.git.${dead}.pending`,
		);
		fs.mkdirSync(pending);
		fs.writeFileSync(
			`${clonePath}.lock`,
			JSON.stringify({
				pid: dead,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'fetch',
			}),
		);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome).toMatchObject({ok: true, message: 'Fetched'});
		expect(fs.existsSync(pending)).toBe(false);
	});
});
