import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	fetchCommitRepos,
	getCommitPatch,
	getCommitsForRef,
	getSquashedDiffForRef,
	repoIdOf,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {getRepoClonePath} from '../lib/commits/commit-repos.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {deriveIssueStats} from '../lib/stats/issue-stats.js';
import {makeTempDir} from './helpers/git-repo.js';

// Reading other repos' clones, as its review found it: re-read on every call,
// ordered by list heads, a fork's share judged on a deduplicated list, a
// patch and a stats scan bounded only by the global cap, a record a subject
// could forge.

const REF = 'AAAAAAA';

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[], date?: string) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
				...(date ? {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date} : {}),
			},
		})
		.toString();

const commit = (
	cwd: string,
	message: string,
	date?: string,
	file = 'f.txt',
	content?: string,
) => {
	if (content === undefined) {
		fs.appendFileSync(path.join(cwd, file), `${message}\n`);
	} else {
		fs.writeFileSync(path.join(cwd, file), content);
	}
	git(cwd, ['add', file]);
	git(cwd, ['commit', '-q', '-m', message], date);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

const PROJECT_ID = 'reading-review';

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
	commit(board, 'init', '2019-01-01T00:00:00Z');
	git(board, ['branch', 'epiq/state']);

	upstream = makeTempDir();
	git(upstream, ['init', '-q', '-b', 'main']);
	commit(upstream, 'init', '2019-01-01T00:00:00Z');
	url = `file://${upstream}`;
	clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

const breakClone = () => {
	fs.rmSync(path.join(clonePath, 'objects'), {recursive: true});
	fs.mkdirSync(path.join(clonePath, 'objects'));
};

describe("a clone's log", () => {
	it('is read once until the clone changes, and again after', async () => {
		commit(upstream, `${REF} upstream`, '2024-01-01T00:00:00Z');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF})),
		).toHaveLength(1);

		// Unreadable now, but unchanged as far as a fetch can tell: the read
		// already made stands.
		breakClone();
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF})),
		).toHaveLength(1);

		// A fetch — by any process — writes the status, and the clone is read
		// again.
		const status = `${clonePath}.json`;
		fs.utimesSync(status, new Date(), new Date(Date.now() + 5_000));
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: REF})),
		).toHaveLength(0);
	});
});

describe('commits from several repos', () => {
	it('come newest first by date, whatever order one repo keeps', async () => {
		// The board's newest commit by its own history carries an old date.
		commit(board, `${REF} board, written 2024`, '2024-06-01T00:00:00Z');
		commit(board, `${REF} board, rebased from 2021`, '2021-01-01T00:00:00Z');
		commit(upstream, `${REF} upstream 2023`, '2023-01-01T00:00:00Z');
		value(upsertCommitRepo({repoRoot: board, url, since: 'all'}));
		value(await fetchCommitRepos({repoRoot: board}));

		const times = value(
			await getCommitsForRef({repoRoot: board, ref: REF}),
		).map(entry => entry.time);

		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	// A commit the fork shares brings its ancestors with it, so the fork's own
	// commits sit above them: its share is just those, and nothing shows twice.
	it('show a fork’s share of a ticket once, as only its own commits', async () => {
		commit(board, `${REF} first`, '2024-01-01T00:00:00Z');
		commit(board, `${REF} second`, '2024-01-02T00:00:00Z');

		const fork = makeTempDir();
		git(fork, ['clone', '-q', board, '.']);
		commit(fork, `${REF} only in the fork`, '2024-01-03T00:00:00Z');
		value(
			upsertCommitRepo({repoRoot: board, url: `file://${fork}`, since: 'all'}),
		);
		value(await fetchCommitRepos({repoRoot: board}));

		const diff = value(
			await getSquashedDiffForRef({repoRoot: board, ref: REF}),
		);

		expect(diff.parts?.map(part => [part.commits, part.contiguous])).toEqual([
			[2, true],
			[1, true],
		]);
		expect(diff.files.map(file => file.path)).toEqual(['f.txt', 'f.txt']);
	});
});

describe('what reading a clone is bounded by', () => {
	it('declines a patch too large for a terminal', async () => {
		const sha = commit(
			upstream,
			`${REF} huge`,
			'2024-01-01T00:00:00Z',
			'huge.txt',
			'line\n'.repeat(2 * 1024 * 1024),
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const result = await getCommitPatch({repoRoot: board, sha});

		expect(isFail(result) ? result.message : '').toMatch(/too large/);
	});

	it('cannot be handed a commit a subject forged', async () => {
		const forged = 'f'.repeat(40);
		commit(
			upstream,
			[
				`${REF} looks ordinary`,
				`\x1e${forged}\x1f1704067200\x1f1704067200\x1fEve\x1feve@example.com\x1f${REF} forged`,
			].join(''),
			'2024-01-01T00:00:00Z',
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const shas = value(await getCommitsForRef({repoRoot: board, ref: REF})).map(
			entry => entry.sha,
		);

		expect(shas).not.toContain(forged);
		expect(shas).toHaveLength(1);
	});

	it('leaves a broken clone out of a ticket’s stats rather than failing them', async () => {
		const own = commit(board, `${REF} board`, '2024-01-01T00:00:00Z');
		const theirs = commit(upstream, `${REF} upstream`, '2024-01-02T00:00:00Z');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		breakClone();

		const stats = await deriveIssueStats({
			repoRoot: board,
			ref: REF,
			commits: [
				{sha: theirs, repo: repoIdOf(url), time: 2, author: 'a', subject: 's'},
				{sha: own, time: 1, author: 'a', subject: 's'},
			],
		});

		expect(isFail(stats)).toBe(false);
	});
});
